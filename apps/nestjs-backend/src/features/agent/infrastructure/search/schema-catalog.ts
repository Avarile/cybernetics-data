import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ISchemaCatalogPort, ISearchSchema } from '../../domain/ports';
import { RECIPES } from '../../domain/search/recipes';
import type { ISchemaField, ITableSchema } from '../../domain/search/schema';
import { SearchTables } from '../knowledge/search-tables';

const cacheMs = 60_000;
const recipeTables = [...new Set(RECIPES.flatMap((r) => r.steps.map((s) => s.table)))].filter(
  Boolean
);

interface IFieldOptions {
  foreignTableId?: string;
  relationship?: NonNullable<ISchemaField['link']>['relationship'];
  isOneWay?: boolean;
  choices?: { name: string }[];
}

const parseOptions = (json: string | null): IFieldOptions => {
  try {
    return json ? (JSON.parse(json) as IFieldOptions) : {};
  } catch {
    return {};
  }
};

/**
 * Live table schemas for the search planner (cockpit design §9.2), read from the meta tables and
 * cached for a minute. Tables are found by name, fields keep their direction and relationship.
 */
@Injectable()
export class SchemaCatalog implements ISchemaCatalogPort {
  private readonly cache = new Map<string, { at: number; value: ISearchSchema }>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly searchTables: SearchTables
  ) {}

  async dataBase(pinned?: string | null) {
    const settings = await this.searchTables.currentSettings();
    const agentSpaceId = settings?.agentSpaceId ?? null;
    const usable = {
      deletedTime: null,
      ...(agentSpaceId ? { NOT: { spaceId: agentSpaceId } } : {}),
    };
    if (pinned) {
      const base = await this.prismaService.base.findFirst({
        where: { id: pinned, ...usable },
        select: { id: true, name: true },
      });
      if (base) return base;
    }
    const tables = await this.prismaService.tableMeta.findMany({
      where: { name: { in: recipeTables }, deletedTime: null, base: usable },
      select: { baseId: true },
    });
    const counts = new Map<string, number>();
    for (const t of tables) counts.set(t.baseId, (counts.get(t.baseId) ?? 0) + 1);
    const [best] = [...counts].sort((a, b) => b[1] - a[1]);
    if (!best) return undefined;
    return (
      (await this.prismaService.base.findUnique({
        where: { id: best[0] },
        select: { id: true, name: true },
      })) ?? undefined
    );
  }

  async schema(baseId: string): Promise<ISearchSchema> {
    const hit = this.cache.get(baseId);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value;
    const value = await this.load(baseId);
    this.cache.set(baseId, { at: Date.now(), value });
    return value;
  }

  private async load(baseId: string): Promise<ISearchSchema> {
    const base = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
      select: { name: true },
    });
    const metas = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true, name: true },
      orderBy: { order: 'asc' },
    });
    const fields = await this.prismaService.field.findMany({
      where: { tableId: { in: metas.map((t) => t.id) }, deletedTime: null },
      select: {
        id: true,
        name: true,
        type: true,
        options: true,
        isPrimary: true,
        isComputed: true,
        isLookup: true,
        tableId: true,
      },
      orderBy: { order: 'asc' },
    });
    const tables: ITableSchema[] = metas.map((t) => ({
      id: t.id,
      name: t.name,
      baseId,
      fields: fields
        .filter((f) => f.tableId === t.id)
        .map((f) => {
          const options = parseOptions(f.options);
          const isLink = f.type === 'link' && !f.isLookup && options.foreignTableId;
          return {
            id: f.id,
            name: f.name,
            type: f.type,
            isPrimary: Boolean(f.isPrimary),
            isComputed: Boolean(f.isComputed || f.isLookup),
            ...(options.choices ? { choices: options.choices.map((c) => c.name) } : {}),
            ...(isLink
              ? {
                  link: {
                    foreignTableId: options.foreignTableId!,
                    relationship: options.relationship ?? 'manyMany',
                    isOneWay: Boolean(options.isOneWay),
                  },
                }
              : {}),
          };
        }),
    }));
    const settings = await this.searchTables.currentSettings();
    const exclude = settings?.exclude ?? new Set<string>();
    const excluded = new Set(
      exclude.has(baseId)
        ? tables.map((t) => t.id)
        : tables.filter((t) => exclude.has(t.id)).map((t) => t.id)
    );
    return { baseId, baseName: base.name, tables, excluded };
  }
}
