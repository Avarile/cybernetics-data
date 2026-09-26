import type { IBaseGraphQueryRo, IBaseGraphSchemaTable, IBaseGraphSchemaVo } from '@teable/openapi';
import { tableNodeId } from '@teable/openapi';
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@teable/ui-lib/shadcn';
import { Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import type { IGraphPreset, ISavedPreset } from '../presets';
import { SYSTEM_TABLE_NAMES } from '../presets';
import { colorForNode } from '../utils/graphTheme';
import {
  groupCandidates,
  hierarchyCandidates,
  isRelationshipOn,
  relationshipsOf,
  toggleRelationship,
  toggleTable,
  updateTable,
} from '../utils/queryEdit';
import { TableFilterDialog } from './TableFilterDialog';

const NONE = '__none__';
const CUSTOM = '__custom__';

interface IGraphQueryPanelProps {
  schema: IBaseGraphSchemaVo;
  ro: IBaseGraphQueryRo | null;
  activePresetId: string | null;
  builtInPresets: IGraphPreset[];
  savedPresets: ISavedPreset[];
  onChange: (ro: IBaseGraphQueryRo) => void;
  onPreset: (id: string) => void;
  onSavePreset: (label: string) => void;
  onDeletePreset: (id: string) => void;
}

const tableColor = (tableId: string) =>
  colorForNode({ tier: 'type', colorKey: tableNodeId(tableId), depth: 0 });

interface ITableOptionsProps {
  schema: IBaseGraphSchemaVo;
  ro: IBaseGraphQueryRo;
  table: IBaseGraphSchemaTable;
  onChange: (ro: IBaseGraphQueryRo) => void;
}

/** View, filter, tree and group for one ticked table. */
const TableOptions = ({ schema, ro, table, onChange }: ITableOptionsProps) => {
  const { t } = useTranslation(['baseGraph']);
  const q = ro.tables.find((x) => x.tableId === table.id);
  if (!q) return null;
  const patch = (p: Parameters<typeof updateTable>[3]) =>
    onChange(updateTable(schema, ro, table.id, p));
  const hierarchy = hierarchyCandidates(table);
  const groups = groupCandidates(table);

  const row = 'grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[11px]';
  return (
    <div className="ml-6 mt-1 space-y-1.5 border-l pl-2">
      <div className={row}>
        <span className="text-muted-foreground">{t('baseGraph:query.view')}</span>
        <Select
          value={q.viewId ?? NONE}
          onValueChange={(v) => patch({ viewId: v === NONE ? undefined : v })}
        >
          <SelectTrigger className="h-6 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('baseGraph:query.allRecords')}</SelectItem>
            {table.views.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={row}>
        <span className="text-muted-foreground">{t('baseGraph:query.filter')}</span>
        <div>
          <TableFilterDialog
            tableId={table.id}
            tableName={table.name}
            value={q.filter ?? undefined}
            onApply={(filter) => patch({ filter })}
          />
        </div>
      </div>
      {hierarchy.length > 0 && (
        <div className={row}>
          <span className="text-muted-foreground">{t('baseGraph:query.hierarchy')}</span>
          <Select
            value={q.hierarchyFieldId ?? NONE}
            onValueChange={(v) => patch({ hierarchyFieldId: v === NONE ? undefined : v })}
          >
            <SelectTrigger className="h-6 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('baseGraph:query.none')}</SelectItem>
              {hierarchy.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {groups.length > 0 && (
        <div className={row}>
          <span className="text-muted-foreground">{t('baseGraph:query.groupBy')}</span>
          <Select
            value={q.groupByFieldId ?? NONE}
            onValueChange={(v) => patch({ groupByFieldId: v === NONE ? undefined : v })}
          >
            <SelectTrigger className="h-6 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('baseGraph:query.none')}</SelectItem>
              {groups.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className={row}>
        <span className="text-muted-foreground">{t('baseGraph:query.limit')}</span>
        <Input
          key={`${table.id}-${q.limit ?? ''}`}
          type="number"
          min={1}
          className="h-6 text-[11px]"
          defaultValue={q.limit ?? ''}
          placeholder="1000"
          onBlur={(e) => {
            const n = Number(e.target.value);
            patch({ limit: Number.isInteger(n) && n > 0 ? n : undefined });
          }}
        />
      </div>
    </div>
  );
};

const PresetBar = (props: IGraphQueryPanelProps) => {
  const { schema, activePresetId, builtInPresets, savedPresets, onPreset } = props;
  const { t } = useTranslation(['baseGraph']);
  const [naming, setNaming] = useState<string | null>(null);

  const unavailable = useMemo(
    () =>
      new Map(
        builtInPresets
          .map((p) => [p.id, p.build(schema).missing] as const)
          .filter(([, m]) => m.length)
      ),
    [builtInPresets, schema]
  );
  const isSaved = savedPresets.some((p) => p.id === activePresetId);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">{t('baseGraph:query.preset')}</Label>
      <div className="flex items-center gap-1">
        <Select value={activePresetId ?? CUSTOM} onValueChange={(v) => v !== CUSTOM && onPreset(v)}>
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!activePresetId && (
              <SelectItem value={CUSTOM}>{t('baseGraph:query.customPreset')}</SelectItem>
            )}
            {builtInPresets.map((p) => (
              <SelectItem
                key={p.id}
                value={p.id}
                disabled={unavailable.has(p.id)}
                title={
                  unavailable.has(p.id)
                    ? t('baseGraph:query.presetUnavailable', {
                        missing: unavailable.get(p.id)?.join(', '),
                      })
                    : undefined
                }
              >
                {p.label}
              </SelectItem>
            ))}
            {savedPresets.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                ★ {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-xs"
          title={t('baseGraph:query.savePreset')}
          onClick={() => setNaming('')}
        >
          <Save className="size-3.5" />
        </Button>
        {isSaved && activePresetId && (
          <Button
            variant="ghost"
            size="icon-xs"
            title={t('baseGraph:query.deletePreset')}
            onClick={() => props.onDeletePreset(activePresetId)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      {naming !== null && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) props.onSavePreset(naming.trim());
            setNaming(null);
          }}
        >
          <Input
            className="h-7 text-xs"
            placeholder={t('baseGraph:query.presetName')}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onBlur={() => !naming && setNaming(null)}
          />
          <Button type="submit" size="xs">
            OK
          </Button>
        </form>
      )}
    </div>
  );
};

/**
 * What is fetched: tables, their filters and tree/group fields, relationships.
 * Every edit goes to the URL through `onChange`, never to the view store.
 */
export const GraphQueryPanel = (props: IGraphQueryPanelProps) => {
  const { schema, ro, onChange } = props;
  const { t } = useTranslation(['baseGraph']);
  const included = new Set(ro?.tables.map((q) => q.tableId));
  const relationships = useMemo(() => (ro ? relationshipsOf(schema, ro) : []), [schema, ro]);

  // System tables sink to the bottom rather than disappearing: they stay
  // pickable, they just should not be the first thing on the list.
  const tables = useMemo(
    () =>
      [...schema.tables].sort(
        (a, b) => Number(SYSTEM_TABLE_NAMES.has(a.name)) - Number(SYSTEM_TABLE_NAMES.has(b.name))
      ),
    [schema]
  );

  const handleToggleTable = (table: IBaseGraphSchemaTable) => {
    const next = ro ? toggleTable(schema, ro, table) : { tables: [{ tableId: table.id }] };
    if (next) onChange(next);
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-background p-3 text-xs">
      <PresetBar {...props} />

      <section className="space-y-1">
        <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
          {t('baseGraph:query.tables')}
        </h3>
        {tables.map((table) => (
          <div key={table.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent">
              <Checkbox
                checked={included.has(table.id)}
                onCheckedChange={() => handleToggleTable(table)}
              />
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: tableColor(table.id) }}
              />
              <span className="truncate">{table.name}</span>
              {table.approxRecordCount !== null && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {t('baseGraph:query.rows', { count: table.approxRecordCount })}
                </span>
              )}
            </label>
            {ro && included.has(table.id) && (
              <TableOptions schema={schema} ro={ro} table={table} onChange={onChange} />
            )}
          </div>
        ))}
      </section>

      <section className="space-y-1">
        <h3 className="text-[11px] font-semibold uppercase text-muted-foreground">
          {t('baseGraph:query.links')}
        </h3>
        {relationships.length === 0 && (
          <p className="text-[11px] text-muted-foreground">{t('baseGraph:query.noLinks')}</p>
        )}
        {ro &&
          relationships.map((rel) => (
            <label key={rel.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5">
              <Checkbox
                checked={isRelationshipOn(ro, rel)}
                onCheckedChange={() => onChange(toggleRelationship(schema, ro, rel))}
              />
              <span className="truncate" title={rel.label}>
                {rel.label}
              </span>
            </label>
          ))}
      </section>

      {ro && (
        <section className="space-y-2">
          <label className="flex items-center justify-between">
            <span>{t('baseGraph:query.tableHubs')}</span>
            <Switch
              checked={Boolean(ro.showTableHubs)}
              onCheckedChange={(on) => onChange({ ...ro, showTableHubs: on })}
            />
          </label>
          <label className="flex items-center justify-between">
            <span>{t('baseGraph:query.baseHub')}</span>
            <Switch
              checked={Boolean(ro.showBaseHub)}
              onCheckedChange={(on) => onChange({ ...ro, showBaseHub: on })}
            />
          </label>
        </section>
      )}
    </div>
  );
};
