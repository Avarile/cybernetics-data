import type { IAgentStatusVo } from '@teable/openapi';
import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { Power } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import s from '../theme/cockpit.module.css';
import d from '../theme/deck.module.css';

export type IPalette = 'mono' | 'cyberpunk';

/**
 * The strip on top (cockpit design §5.2, the cockpit's annunciator): the sources (base and
 * table) on the left, the link (palette, status, clock, power) on the right.
 */
export const Annunciator = ({ sources, link }: { sources: ReactNode; link: ReactNode }) => {
  const { t } = useTranslation('common');
  return (
    <header className={`${s.annunciator} ${d.top}`} data-annunciator>
      <h1 className="sr-only">{t('agent.cockpit.title', 'AGENT COCKPIT')}</h1>
      <nav className={s.sources} aria-label={t('agent.cockpit.sources', 'Base and table')}>
        {sources}
      </nav>
      <div className={s.link}>{link}</div>
    </header>
  );
};

type IT = (key: string, fallback: string) => string;

/** The chip's word: linking, live with the model, working, needs setup, not enabled. */
function statusWord(status: IAgentStatusVo | undefined, busy: boolean, t: IT) {
  if (!status) return { state: 'linking', word: t('agent.cockpit.linking', 'LINKING') };
  if (!status.enabled) return { state: 'error', word: t('agent.cockpit.off', 'NOT ENABLED') };
  if (status.status !== 'ok')
    return { state: 'error', word: t('agent.cockpit.needsSetup', 'NEEDS SETUP') };
  const model = status.models?.find((m) => m.slot === 'model')?.ref;
  const word = busy ? t('agent.cockpit.working', 'WORKING') : t('agent.cockpit.live', 'LIVE');
  return { state: busy ? 'busy' : 'live', word: model ? `${word} · ${model}` : word };
}

const DiagList = ({ status, t }: { status?: IAgentStatusVo; t: IT }) => (
  <dl>
    <dt>{t('agent.cockpit.diag.status', 'STATUS')}</dt>
    <dd>{status ? `${status.enabled ? 'enabled' : 'off'} · ${status.status}` : '—'}</dd>
    {status?.models?.map((m) => (
      <div key={m.slot} style={{ display: 'contents' }}>
        <dt>{m.slot.toUpperCase()}</dt>
        <dd>{[m.ref ?? '—', m.error].filter(Boolean).join(' · ')}</dd>
      </div>
    ))}
    <dt>{t('agent.cockpit.diag.checked', 'CHECKED')}</dt>
    <dd>{status?.lastVerifiedTime?.slice(0, 16).replace('T', ' ') ?? '—'}</dd>
    {status?.lastError && (
      <>
        <dt>{t('agent.cockpit.diag.error', 'ERROR')}</dt>
        <dd>{status.lastError}</dd>
      </>
    )}
    {status?.warnings?.map((w) => (
      <div key={w.code} style={{ display: 'contents' }}>
        <dt>{t('agent.cockpit.diag.warning', 'WARNING')}</dt>
        <dd>{w.message ?? w.code}</dd>
      </div>
    ))}
  </dl>
);

/** Link state of the agent, with its diagnostics on click (the cockpit's link chip and panel). */
export const StatusChip = ({
  status,
  busy,
  onLeave,
}: {
  status?: IAgentStatusVo;
  busy: boolean;
  onLeave?: () => void;
}) => {
  const { t } = useTranslation('common');
  const { state, word } = statusWord(status, busy, t as IT);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={s.chip}
          data-state={state}
          aria-label={t('agent.cockpit.status', 'Agent status')}
        >
          <i aria-hidden />
          <span>{word}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`dark w-80 ${s.diag}`}>
        <DiagList status={status} t={t as IT} />
        <Link href="/admin/agent" onClick={onLeave}>
          {t('agent.panel.openSettings', 'Open Admin ▸ Agent')}
        </Link>
      </PopoverContent>
    </Popover>
  );
};

export const PaletteSwitch = ({
  value,
  onChange,
}: {
  value: IPalette;
  onChange: (p: IPalette) => void;
}) => {
  const { t } = useTranslation('common');
  return (
    <span className={s.knobs} role="group" aria-label={t('agent.cockpit.palette', 'Colour theme')}>
      {(['mono', 'cyberpunk'] as const).map((p) => (
        <button
          key={p}
          type="button"
          className={s.knob}
          aria-pressed={value === p}
          onClick={() => onChange(p)}
        >
          {p.toUpperCase()}
        </button>
      ))}
    </span>
  );
};

/** UTC time, as the cockpit's zulu clock. */
export const ZuluClock = () => {
  const [now, setNow] = useState<Date>();
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return <time className={s.zulu}>--</time>;
  const p = (n: number) => String(n).padStart(2, '0');
  const mon = now.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  return (
    <time className={s.zulu} dateTime={now.toISOString()}>
      {p(now.getUTCDate())} {mon} {now.getUTCFullYear()} · {p(now.getUTCHours())}:
      {p(now.getUTCMinutes())}:{p(now.getUTCSeconds())}Z
    </time>
  );
};

/** On/off: the only way out besides Ctrl/⌘ J (cockpit design §4.1). */
export const PowerToggle = ({ busy, onOff }: { busy: boolean; onOff: () => void }) => {
  const { t } = useTranslation('common');
  return (
    <button
      type="button"
      className={s.power}
      data-busy={busy}
      title={t('agent.cockpit.offButton', 'Turn the cockpit off (Ctrl/⌘ J)')}
      onClick={onOff}
    >
      <Power className="size-4" />
    </button>
  );
};
