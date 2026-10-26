import type { IAgentSetupVo, IGatewayModel, IUpdateAgentSetupRo } from '@teable/openapi';
import { AGENT_APPROVAL_CATEGORIES, AGENT_TOOLKIT_IDS } from '@teable/openapi';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { buildPickerGroups } from '../../../components/ai/model-picker-options';
import { ModelPicker } from '../../../components/ai/ModelPicker';
import { useAiProviders } from '../ai-setting/providers/useProviders';
import { keyToRef, refToKey, toggle } from './agent-admin.helpers';

type ISave = (patch: IUpdateAgentSetupRo) => void;
const slots = ['model', 'smallModel', 'embeddingModel', 'rerankModel'] as const;

/** The four model slots, picked from the provider registry (design §13). */
export const AgentModelsCard = ({
  setup,
  gatewayModels,
  onSave,
}: {
  setup: IAgentSetupVo;
  gatewayModels: IGatewayModel[];
  onSave: ISave;
}) => {
  const { t } = useTranslation('common');
  const { data } = useAiProviders();
  const groups = useMemo(
    () => buildPickerGroups(data?.providers ?? [], gatewayModels),
    [data?.providers, gatewayModels]
  );
  const labels: Record<(typeof slots)[number], string> = {
    model: t('agent.admin.chatModel', 'Chat model (needs tool use)'),
    smallModel: t('agent.admin.smallModel', 'Small model (titles, summaries, memory)'),
    embeddingModel: t('agent.admin.embeddingModel', 'Embedding model (knowledge search)'),
    rerankModel: t('agent.admin.rerankModel', 'Rerank model'),
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('agent.admin.models', 'Models')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {slots.map((slot) => {
          const ref = setup[slot];
          const key = refToKey(ref, groups);
          return (
            <div key={slot} className="space-y-1.5">
              <Label>{labels[slot]}</Label>
              <ModelPicker
                value={key}
                groups={groups}
                requires={slot === 'model' ? ['tool-use'] : undefined}
                placeholder={ref && !key ? ref : undefined}
                clearLabel={slot === 'model' ? undefined : t('agent.admin.none', 'None')}
                onClear={slot === 'model' ? undefined : () => onSave({ [slot]: null })}
                onChange={(picked) => {
                  const next = keyToRef(picked, groups);
                  if (next) onSave({ [slot]: next });
                }}
              />
              {ref && !key && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t('agent.admin.modelMissing', 'Not offered by any enabled provider.')}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

/** Persona, toolkits, approvals, memory and limits; saved to the default agent_setup row. */
export const AgentBehaviourCard = ({ setup, onSave }: { setup: IAgentSetupVo; onSave: ISave }) => {
  const { t } = useTranslation('common');
  const [persona, setPersona] = useState(setup.persona ?? '');
  const [maxSteps, setMaxSteps] = useState(String(setup.maxSteps ?? 25));
  const toolkits = setup.toolkits as (typeof AGENT_TOOLKIT_IDS)[number][];
  const approvals = setup.approvalRequired as (typeof AGENT_APPROVAL_CATEGORIES)[number][];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('agent.admin.behaviour', 'Behaviour')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="agent-persona">{t('agent.admin.persona', 'Persona')}</Label>
          <Textarea
            id="agent-persona"
            rows={6}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={persona === (setup.persona ?? '')}
            onClick={() => onSave({ persona: persona || null })}
          >
            {t('actions.save', 'Save')}
          </Button>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('agent.admin.toolkits', 'Toolkits')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {AGENT_TOOLKIT_IDS.map((id) => (
              <label
                key={id}
                className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
              >
                <span>{id}</span>
                <Switch
                  checked={toolkits.includes(id)}
                  onCheckedChange={(on) =>
                    onSave({ toolkits: toggle(toolkits, id, on, AGENT_TOOLKIT_IDS) })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t('agent.admin.approvals', 'Ask before running')}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {AGENT_APPROVAL_CATEGORIES.map((id) => (
              <label
                key={id}
                className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
              >
                <span>{id}</span>
                <Switch
                  checked={approvals.includes(id)}
                  onCheckedChange={(on) =>
                    onSave({
                      approvalRequired: toggle(approvals, id, on, AGENT_APPROVAL_CATEGORIES),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('agent.admin.memoryMode', 'Memory')}</Label>
            <Select
              value={setup.memoryMode ?? 'explicit'}
              onValueChange={(v) => onSave({ memoryMode: v as 'off' | 'explicit' | 'auto' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t('agent.admin.memoryOff', 'Off')}</SelectItem>
                <SelectItem value="explicit">
                  {t('agent.admin.memoryExplicit', 'Only when asked')}
                </SelectItem>
                <SelectItem value="auto">
                  {t('agent.admin.memoryAuto', 'Also learn after each turn')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-steps">{t('agent.admin.maxSteps', 'Steps per turn')}</Label>
            <Input
              id="agent-steps"
              type="number"
              min={1}
              max={100}
              value={maxSteps}
              onChange={(e) => setMaxSteps(e.target.value)}
              onBlur={() => {
                const n = Number(maxSteps);
                if (Number.isInteger(n) && n >= 1 && n <= 100 && n !== setup.maxSteps) {
                  onSave({ maxSteps: n });
                }
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
