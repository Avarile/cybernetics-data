import { Injectable } from '@nestjs/common';
import type { IBaseGraphQueryRo } from '@teable/openapi';
import { PermissionService } from '../../../auth/permission.service';
import { BaseGraphService } from '../../../base-graph/base-graph.service';
import type { IOverviewGraphPort } from '../../domain/ports';

/**
 * The overview's graph from the base graph (overview design §8.2): the same assembler and rows
 * as /graph, read as the admin, after the check the base-graph route itself makes.
 */
@Injectable()
export class BaseGraphOverviewReader implements IOverviewGraphPort {
  constructor(
    private readonly baseGraph: BaseGraphService,
    private readonly permissions: PermissionService
  ) {}

  async assertReadable(baseId: string) {
    await this.permissions.validPermissions(baseId, ['record|read']);
  }

  async read(baseId: string, query: IBaseGraphQueryRo) {
    const { vo } = await this.baseGraph.query(baseId, query);
    return vo!;
  }
}
