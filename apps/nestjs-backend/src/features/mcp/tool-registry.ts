import { Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import type { IMcpToolGroup } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { McpConfig, type IMcpConfig } from '../../configs/mcp.config';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { BaseService } from '../base/base.service';
import { BaseGraphService } from '../base-graph/base-graph.service';
import { GraphNodeService } from '../base-graph/graph-node.service';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { SpaceService } from '../space/space.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { ViewService } from '../view/view.service';
import { buildDiscoveryTools } from './tools/discovery.tools';
import { buildGraphTools } from './tools/graph.tools';
import { buildRecordTools } from './tools/record.tools';
import { buildSchemaTools } from './tools/schema.tools';
import type { IMcpTool, IMcpToolContext, IMcpRuntimeConfig, IMcpTokenScope } from './types';

@Injectable()
export class McpToolRegistry {
  private readonly logger = new Logger(McpToolRegistry.name);
  private readonly tools: Map<string, IMcpTool>;
  private readonly groups = new Map<string, IMcpToolGroup>();
  private readonly runtimeConfig: IMcpRuntimeConfig;

  constructor(
    @McpConfig() private readonly config: IMcpConfig,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService,
    private readonly spaceService: SpaceService,
    private readonly baseService: BaseService,
    private readonly tableService: TableOpenApiService,
    private readonly fieldService: FieldOpenApiService,
    private readonly recordService: RecordService,
    private readonly recordWriteService: RecordOpenApiService,
    private readonly viewService: ViewService,
    private readonly viewWriteService: ViewOpenApiService,
    private readonly graphService: BaseGraphService,
    private readonly graphNodeService: GraphNodeService
  ) {
    this.runtimeConfig = {
      readonly: config.readonly,
      maxRecordsPerCall: config.maxRecordsPerCall,
      maxDeletePerCall: config.maxDeletePerCall,
    };
    this.tools = this.build();
  }

  private build(): Map<string, IMcpTool> {
    const all: { tool: IMcpTool; group: IMcpToolGroup }[] = [
      ...buildDiscoveryTools().map((tool) => ({ tool, group: 'discovery' as const })),
      ...buildRecordTools().map((tool) => ({ tool, group: 'record' as const })),
      ...buildSchemaTools().map((tool) => ({ tool, group: 'schema' as const })),
      // Read-only views over records, so they sit with discovery in the UI.
      ...buildGraphTools().map((tool) => ({ tool, group: 'discovery' as const })),
    ];

    const map = new Map<string, IMcpTool>();
    for (const { tool, group } of all) {
      // A tool that declares no actions would be an unauthenticated data path.
      // Fail at boot rather than in production.
      if (tool.requiredActions.length === 0) {
        throw new Error(`MCP tool "${tool.name}" declares no requiredActions`);
      }
      if (map.has(tool.name)) {
        throw new Error(`MCP tool "${tool.name}" is registered twice`);
      }
      if (this.runtimeConfig.readonly && !tool.annotations.readOnlyHint) {
        continue;
      }
      this.groups.set(tool.name, group);
      map.set(tool.name, tool);
    }

    this.logger.log(
      `MCP catalogue: ${map.size} tools${this.runtimeConfig.readonly ? ' (read-only mode)' : ''}`
    );
    return map;
  }

  list(): IMcpTool[] {
    return [...this.tools.values()];
  }

  get(name: string): IMcpTool | undefined {
    return this.tools.get(name);
  }

  groupOf(name: string): IMcpToolGroup {
    return this.groups.get(name) ?? 'discovery';
  }

  get runtime(): IMcpRuntimeConfig {
    return this.runtimeConfig;
  }

  /**
   * The only path to a tool's execute().
   *
   * Callers must invoke this sequentially — never under Promise.all. Each call
   * writes request-scoped cls state, so concurrent calls within one HTTP
   * request would interleave and cross-contaminate permissions.
   */
  async invoke(name: string, rawArgs: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new CustomHttpException(`Unknown tool "${name}"`, HttpErrorCode.NOT_FOUND);
    }

    const args = tool.inputSchema.parse(rawArgs ?? {});
    const permissions = await this.authorize(tool, args);
    const tokenScope = await this.loadTokenScope();

    return tool.execute(args, this.buildContext(permissions, tokenScope));
  }

  /**
   * Resolve the permission subject, check it, and publish the result to cls.
   *
   * The cls.set is not optional bookkeeping: table-open-api.service.ts:833,
   * base.service.ts:542, selection.service.ts:476 and
   * record-open-api-v2.service.ts:902 read permissions back from cls. Skipping
   * it yields wrong output with a 200 status rather than an error.
   */
  private async authorize(tool: IMcpTool, args: unknown) {
    const accessTokenId = this.cls.get('accessTokenId');
    const resourceId = tool.resolveResource(args);

    if (resourceId === null) {
      // List-filtered tool: the underlying service scopes results to the
      // caller, so there is no single resource to validate against. Publish
      // the token's own scopes so downstream consumers still see a truthful
      // permission set.
      const scopes = accessTokenId
        ? (await this.permissionService.getAccessToken(accessTokenId)).scopes
        : this.cls.get('permissions');
      this.cls.set('permissions', scopes ?? []);
      return scopes ?? [];
    }

    const ownPermissions = await this.permissionService.validPermissions(
      resourceId,
      tool.requiredActions,
      accessTokenId
    );
    this.cls.set('permissions', ownPermissions);
    return ownPermissions;
  }

  /** Null for a session user, who has no token restriction to apply. */
  private async loadTokenScope(): Promise<IMcpTokenScope | null> {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) {
      return null;
    }
    const { spaceIds, baseIds, hasFullAccess } =
      await this.permissionService.getAccessToken(accessTokenId);
    return { spaceIds, baseIds, hasFullAccess };
  }

  private buildContext(
    permissions: IMcpToolContext['permissions'],
    tokenScope: IMcpTokenScope | null
  ): IMcpToolContext {
    return {
      spaceService: this.spaceService,
      baseService: this.baseService,
      tableService: this.tableService,
      fieldService: this.fieldService,
      recordService: this.recordService,
      recordWriteService: this.recordWriteService,
      viewService: this.viewService,
      viewWriteService: this.viewWriteService,
      graphService: this.graphService,
      graphNodeService: this.graphNodeService,
      permissions,
      tokenScope,
      config: this.runtimeConfig,
      resolveBaseId: async (tableId: string) =>
        (await this.permissionService.getUpperIdByTableId(tableId)).baseId,
    };
  }
}
