import type { ICockpitBase } from '@teable/openapi';
import { Input, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib/shadcn';
import { Star } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import s from '../theme/cockpit.module.css';

export interface IBaseMenuProps {
  bases: ICockpitBase[];
  currentId?: string;
  defaultId: string | null;
  /** Tables of the current base, for the button's small line. */
  tableCount?: number;
  settingDefault?: boolean;
  onPick: (baseId: string) => void;
  onSetDefault: (baseId: string) => void;
}

/** ★ filled for the default base, outlined otherwise: a click makes the base the default. */
const DefaultStar = ({
  isDefault,
  disabled,
  name,
  onClick,
}: {
  isDefault: boolean;
  disabled?: boolean;
  name: string;
  onClick: () => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <button
      type="button"
      className={s.star}
      aria-pressed={isDefault}
      disabled={disabled || isDefault}
      title={
        isDefault
          ? t('agent.cockpit.base.isDefault', 'The default base')
          : t('agent.cockpit.base.setDefault', 'Make the default base')
      }
      aria-label={
        isDefault
          ? t('agent.cockpit.base.isDefaultNamed', {
              name,
              defaultValue: `${name} is the default base`,
            })
          : t('agent.cockpit.base.setDefaultNamed', {
              name,
              defaultValue: `Make ${name} the default base`,
            })
      }
      onClick={onClick}
    >
      <Star className="size-3.5" fill={isDefault ? 'currentColor' : 'none'} />
    </button>
  );
};

/**
 * The annunciator's base menu (scope design §5.1, replacing the thread menu): the current base,
 * DEFAULT or its table count, a ★ to make it the default, and every base by space to pick from.
 */
export const BaseMenu = (p: IBaseMenuProps) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = p.bases.find((b) => b.id === p.currentId);
  const spaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<string, ICockpitBase[]>();
    for (const base of p.bases.filter((b) => !q || b.name.toLowerCase().includes(q)))
      groups.set(base.spaceName, [...(groups.get(base.spaceName) ?? []), base]);
    return [...groups];
  }, [p.bases, search]);
  const isDefault = Boolean(current && current.id === p.defaultId);
  let small = '';
  if (isDefault) small = t('agent.cockpit.base.default', 'DEFAULT');
  else if (p.tableCount !== undefined)
    small = t('agent.cockpit.base.tables', {
      n: p.tableCount,
      defaultValue: `${p.tableCount} TABLES`,
    });

  return (
    <>
      <span className={s.lbl}>{t('agent.cockpit.base.label', 'BASE')}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={s.menuButton} aria-haspopup="listbox">
            <b>{current?.name ?? '—'}</b>
            {small && <small>{small}</small>}
            <i className={s.caret} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="dark w-80 p-2">
          <Input
            value={search}
            placeholder={t('agent.cockpit.base.search', 'Search bases')}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul
            role="listbox"
            aria-label={t('agent.cockpit.base.list', 'Bases')}
            className="mt-2 max-h-80 overflow-y-auto"
          >
            {spaces.map(([space, bases]) => (
              <li key={space} role="presentation">
                <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider opacity-60">
                  {space}
                </div>
                <ul role="group" aria-label={space} className="space-y-0.5">
                  {bases.map((base) => (
                    <li
                      key={base.id}
                      role="option"
                      aria-selected={base.id === p.currentId}
                      className={cn(
                        'flex items-center gap-1 rounded px-2 py-1',
                        base.id === p.currentId && 'bg-accent'
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => {
                          setOpen(false);
                          if (base.id !== p.currentId) p.onPick(base.id);
                        }}
                      >
                        {base.name}
                      </button>
                      <DefaultStar
                        isDefault={base.id === p.defaultId}
                        disabled={p.settingDefault}
                        name={base.name}
                        onClick={() => p.onSetDefault(base.id)}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {!spaces.length && (
              <li className="px-2 py-4 text-center text-xs opacity-70">
                {t('agent.cockpit.base.none', 'No bases')}
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
      {current && (
        <DefaultStar
          isDefault={isDefault}
          disabled={p.settingDefault}
          name={current.name}
          onClick={() => p.onSetDefault(current.id)}
        />
      )}
    </>
  );
};
