import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgentStatus } from '../hooks/useAgentData';
import { useRecordReader } from '../hooks/useRecordReader';
import { chooseBase, holdTable, useScope } from '../hooks/useScope';
import { useTableSearch } from '../hooks/useTableSearch';
import { parseInput, resolveName, suggest, type ISuggestion } from '../model/commands';
import { currentDataset } from '../model/overview/cycle';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchStore } from '../state/search-store';
import { AskLog } from '../ui/ask/AskLog';
import { AgentComposer } from '../ui/ask/Composer';
import { RecordModal } from '../ui/stage/RecordModal';
import s from '../ui/theme/cockpit.module.css';
import p from '../ui/theme/panels.module.css';
import { useVoiceConversation } from '../voice/useVoiceConversation';

/** The table on the stage: what a query searches (scope design §7.2). */
const tableOnStage = () =>
  currentDataset(useCockpitStore.getState().cycle) ?? useSearchStore.getState().tables[0]?.id;

/**
 * The ask panel at the top of the rail (scope design §6, the cockpit's ASK panel): the log and
 * the command line with voice. `/base` and `/table` choose the scope; anything else is searched
 * on the table on the stage. It enlarges to the middle of the screen; Escape or the backdrop puts
 * it back.
 */
export const AskContainer = () => {
  const { t } = useTranslation('common');
  const scope = useScope();
  const { data: agent } = useAgentStatus();
  const log = useSearchStore((st) => st.log);
  const { searching } = useTableSearch();
  const [expanded, setExpanded] = useState(false);
  const [hint, setHint] = useState<string>();
  const onStage = useCockpitStore((st) => currentDataset(st.cycle));
  const tableName = (scope.tables.find((x) => x.id === onStage) ?? scope.tables[0])?.name ?? '';

  const suggestionsFor = useCallback(
    (value: string) => suggest(parseInput(value), scope.bases, scope.tables, scope.defaultBaseId),
    [scope.bases, scope.tables, scope.defaultBaseId]
  );

  const applyBase = (id: string, name: string) => {
    chooseBase(id);
    useSearchStore.getState().addLog('base', name);
  };
  const applyTable = (id: string, name: string) => {
    if (!holdTable(id)) return false;
    useSearchStore.getState().addLog('table', name);
    return true;
  };
  /** A query runs on the table on the stage; the same text again only on Enter (a refetch). */
  const search = (text: string, again: boolean) => {
    const tableId = tableOnStage();
    if (!tableId) return setHint(t('agent.composer.noTable', 'NO TABLE TO SEARCH'));
    const active = useSearchStore.getState().query;
    if (!again && active?.text === text && active.tableId === tableId) return;
    useSearchStore.getState().search(text, tableId);
  };

  const submit = (raw: string, via: 'enter' | 'idle' | 'voice'): boolean => {
    const parsed = parseInput(raw);
    setHint(undefined);
    if (parsed.kind === 'query') {
      search(parsed.text, via !== 'idle');
      return false;
    }
    if (via === 'idle') return false;
    if (parsed.kind === 'base') {
      const base = resolveName(scope.bases, parsed.arg);
      if (base) applyBase(base.id, base.name);
      else
        setHint(
          t('agent.composer.noBase', {
            name: parsed.arg,
            defaultValue: `NO BASE NAMED "${parsed.arg}"`,
          })
        );
      return Boolean(base);
    }
    if (parsed.kind === 'table') {
      const table = resolveName(scope.tables, parsed.arg);
      if (table && applyTable(table.id, table.name)) return true;
      setHint(
        t('agent.composer.noTableNamed', {
          name: parsed.arg,
          base: scope.base?.name ?? '',
          defaultValue: `NO TABLE NAMED "${parsed.arg}" IN ${scope.base?.name ?? ''}`,
        })
      );
      return false;
    }
    if (parsed.kind !== 'empty')
      setHint(t('agent.composer.unknown', 'UNKNOWN COMMAND · /base, /table'));
    return false;
  };
  const pick = (suggestion: ISuggestion) => {
    setHint(undefined);
    if (suggestion.kind === 'base') applyBase(suggestion.id, suggestion.name);
    if (suggestion.kind === 'table') applyTable(suggestion.id, suggestion.name);
  };
  /** Text being typed holds the table on the stage until it is searched (scope design §5.3). */
  const typing = (text: string) => {
    const parsed = parseInput(text);
    const pending =
      parsed.kind === 'query' && parsed.text !== useSearchStore.getState().query?.text;
    useCockpitStore.getState().cycleEvent({ type: pending ? 'hold' : 'release', reason: 'typing' });
  };
  useEffect(
    () => () => useCockpitStore.getState().cycleEvent({ type: 'release', reason: 'typing' }),
    []
  );

  const voice = useVoiceConversation({
    messages: [],
    busy: false,
    disabled: false,
    send: (text) => void submit(text, 'voice'),
  });
  // the reader speaks through this panel's voice, so there is one queue and one microphone
  const reader = useRecordReader(voice);
  const cockpit = typeof document === 'undefined' ? null : document.querySelector('[data-cockpit]');
  const leave = () => useCockpitStore.getState().close();
  const clear = () => {
    voice.stopSpeech();
    const store = useSearchStore.getState();
    store.clearSearch();
    store.clearLog();
    store.closeRecord();
    useCockpitStore.getState().pinOverview(undefined);
    setHint(undefined);
  };

  // Escape puts the enlarged panel back before the cockpit's own keys see it
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  const table = tableName.toUpperCase();
  return (
    <>
      {expanded && (
        // the panel's ✕ and Escape do the same from the keyboard
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className={p.backdrop} onClick={() => setExpanded(false)} />
      )}
      {reader.open &&
        createPortal(
          <RecordModal
            record={reader.record}
            loading={reader.loading}
            error={reader.error}
            summary={reader.summary}
            onClose={reader.close}
            onLeave={leave}
          />,
          cockpit ?? document.body
        )}
      <section
        className={`${p.panel} ${p.ask}`}
        data-expanded={expanded}
        aria-label={t('agent.cockpit.askLabel', 'Ask the agent')}
      >
        <h2>
          {t('agent.cockpit.ask', 'ASK THE AGENT')}
          <span>
            {searching && <small>{t('agent.cockpit.searching', 'SEARCHING')}</small>}
            <button type="button" className={s.knob} onClick={clear}>
              {t('agent.cockpit.clear', 'CLEAR')}
            </button>
            <button
              type="button"
              className={s.knob}
              aria-pressed={expanded}
              aria-label={
                expanded
                  ? t('agent.cockpit.collapse', 'Put the panel back')
                  : t('agent.cockpit.expand', 'Enlarge the panel')
              }
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '✕' : '⤢'}
            </button>
          </span>
        </h2>
        <AskLog
          lines={log}
          hint={t('agent.cockpit.logHint', {
            table,
            defaultValue: `Type to search ${table}, /base to change the database, /table to change the table.`,
          })}
        />
        <div className={s.composer}>
          <AgentComposer
            busy={searching}
            disabled={!scope.bases.length && !agent}
            placeholder={t('agent.composer.placeholder', {
              table,
              defaultValue: `Search ${table} · /base · /table`,
            })}
            suggestionsFor={suggestionsFor}
            hint={hint}
            onSubmit={(text) => submit(text, 'enter')}
            onIdle={(text) => void submit(text, 'idle')}
            onPick={pick}
            onChange={typing}
            voice={voice}
          />
        </div>
      </section>
    </>
  );
};
