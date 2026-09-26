import type { Action } from '@teable/core';
import type { z } from 'zod';
import type { BaseService } from '../base/base.service';
import type { BaseGraphService } from '../base-graph/base-graph.service';
import type { GraphNodeService } from '../base-graph/graph-node.service';
import type { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import type { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import type { RecordService } from '../record/record.service';
import type { SpaceService } from '../space/space.service';
import type { TableOpenApiService } from '../table/open-api/table-open-api.service';
import type { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import type { ViewService } from '../view/view.service';

export interface IMcpRuntimeConfig {
  readonly: boolean;
  maxRecordsPerCall: number;
  maxDeletePerCall: number;
}

export interface IMcpTokenScope {
  spaceIds?: string[];
  baseIds?: string[];
  hasFullAccess?: boolean;
}

/**
 * Services a tool may reach, plus the permissions resolved for this call.
 * Injected by the registry so a tool is plain data and cannot acquire
 * dependencies — or authorization — of its own.
 */
export interface IMcpToolContext {
  spaceService: SpaceService;
  baseService: BaseService;
  tableService: TableOpenApiService;
  fieldService: FieldOpenApiService;
  recordService: RecordService;
  recordWriteService: RecordOpenApiService;
  viewService: ViewService;
  viewWriteService: ViewOpenApiService;
  graphService: BaseGraphService;
  graphNodeService: GraphNodeService;
  /** Already intersected with the token's scopes by validPermissions. */
  permissions: Action[];
  /**
   * The presenting token's resource restriction, or null for a session user.
   *
   * Only needed by list-filtered tools whose backing service filters by USER
   * but not by TOKEN — `BaseService.getAllBaseList` is the case in point. Tools
   * that resolve a concrete resource never need this: validPermissions already
   * enforces the restriction for them.
   */
  tokenScope: IMcpTokenScope | null;
  config: IMcpRuntimeConfig;
  /** Resolves a tableId to its owning baseId — several services require both. */
  resolveBaseId(tableId: string): Promise<string>;
}

export interface IMcpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

/**
 * A tool is inert data plus an `execute`. It never calls PermissionService
 * itself: the registry authorizes before `execute` is reached, so a tool that
 * forgets to authorize is not expressible.
 */
export interface IMcpTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  inputSchema: TSchema;
  annotations: IMcpToolAnnotations;
  /** Non-empty — enforced at registry construction. */
  requiredActions: Action[];
  /**
   * The permission subject: spc… | bse… | tbl…. Returning null means the tool
   * is list-filtered (the underlying service scopes results to the caller) and
   * has no single resource to check.
   */
  resolveResource(args: z.infer<TSchema>): string | null;
  execute(args: z.infer<TSchema>, ctx: IMcpToolContext): Promise<unknown>;
}

/**
 * Preserves per-tool argument inference inside a tool literal while erasing to
 * IMcpTool at the array boundary — without it TSchema widens to its default and
 * every `args` becomes `unknown`.
 */
export const defineTool = <TSchema extends z.ZodTypeAny>(tool: IMcpTool<TSchema>): IMcpTool =>
  tool as unknown as IMcpTool;
