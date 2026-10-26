import { Button, Input } from '@teable/ui-lib/shadcn';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { IHeaderRow } from './provider-form';

interface IHeadersEditorProps {
  rows: IHeaderRow[];
  onChange: (rows: IHeaderRow[]) => void;
  /** Example headers for this provider type (e.g. OpenRouter's HTTP-Referer and X-Title). */
  hints?: Record<string, string>;
  error?: string;
}

/** Static headers sent with every request; a value may be `env:VAR`. */
export const HeadersEditor = ({ rows, onChange, hints, error }: IHeadersEditorProps) => {
  const { t } = useTranslation('common');
  const set = (i: number, patch: Partial<IHeaderRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const missingHints = Object.entries(hints ?? {}).filter(
    ([name]) => !rows.some((r) => r.name.toLowerCase() === name.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t(
          'admin.setting.ai.providers.headersHelp',
          'Sent with every request. A value can read an env var: env:VAR_NAME.'
        )}
      </p>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={row.name}
            onChange={(e) => set(i, { name: e.target.value })}
            placeholder="X-Title"
            className="w-2/5 font-mono text-xs"
          />
          <Input
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder="value or env:VAR"
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('actions.remove')}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => onChange([...rows, { name: '', value: '' }])}
        >
          <Plus className="size-3" />
          {t('admin.setting.ai.providers.addHeader', 'Add header')}
        </Button>
        {missingHints.map(([name, value]) => (
          <Button
            key={name}
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => onChange([...rows, { name, value }])}
          >
            + {name}
          </Button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
};
