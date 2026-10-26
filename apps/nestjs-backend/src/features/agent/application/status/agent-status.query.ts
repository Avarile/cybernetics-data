import { FieldKeyType } from '@cybernetics/core';
import { Inject, Injectable } from '@nestjs/common';
import type {
  IAgentModelSlot,
  IAgentModelStatus,
  IAgentStatusVo,
  IAgentWarning,
} from '@teable/openapi';
import { SecretsConfig, type ISecretsConfig } from '../../../../configs/secrets.config';
import { RecordService } from '../../../record/record.service';
import { MODEL_PORT, type IModelPort } from '../../domain/ports';
import { AgentExecutionContext } from '../../infrastructure/execution-context';
import { AGENT_TABLES } from '../../pack/agent-pack';
import type { IAgentInstallationView } from '../installation/ensure-installation.usecase';
import { EnsureInstallation } from '../installation/ensure-installation.usecase';

export const MODEL_SLOTS: IAgentModelSlot[] = [
  'model',
  'small_model',
  'embedding_model',
  'rerank_model',
];

type ISetupRow = Record<string, unknown>;

/** The setup the agent runs with: the active default, else the first active row. */
export function pickDefaultSetup(rows: ISetupRow[]): ISetupRow | undefined {
  const active = rows.filter((r) => r.is_active === true);
  return active.find((r) => r.is_default === true) ?? active[0];
}

/** Everything an admin should fix before (or while) the agent runs. */
export function buildWarnings(
  view: Pick<IAgentInstallationView, 'enabled' | 'status' | 'lastError' | 'health'>,
  models: IAgentModelStatus[],
  secretsKeyConfigured: boolean
): IAgentWarning[] {
  const warnings: IAgentWarning[] = [];
  if (!view.enabled) {
    warnings.push({ code: 'not_enabled', message: 'The agent is not enabled.' });
  } else if (view.status !== 'ok') {
    warnings.push({ code: 'installation', message: view.lastError ?? `Status: ${view.status}` });
  }
  if (!secretsKeyConfigured) {
    warnings.push({
      code: 'secrets_key_missing',
      message:
        'BACKEND_SECRETS_ENCRYPTION_KEY is not set: secrets are encrypted with a key derived from SECRET_KEY. Set a dedicated key.',
    });
  }
  const mismatched = (view.health?.mismatched ?? []) as { field: string; expected: string }[];
  for (const m of mismatched) {
    warnings.push({
      code: 'field_type_changed',
      message: `${m.field} should be ${m.expected}; tools that use it may fail.`,
    });
  }
  if (view.enabled && view.status === 'ok') {
    const chat = models.find((m) => m.slot === 'model');
    if (!chat?.ref) {
      warnings.push({ code: 'no_chat_model', message: 'Choose a chat model in the agent setup.' });
    }
    for (const m of models.filter((m) => m.ref && !m.ok)) {
      warnings.push({ code: 'model_unavailable', message: `${m.slot}: ${m.error ?? m.ref}` });
    }
  }
  return warnings;
}

/** GET /api/agent/status (design §12). Reads only; repairs happen on enable, verify and turns. */
@Injectable()
export class AgentStatusQuery {
  constructor(
    private readonly installation: EnsureInstallation,
    private readonly execution: AgentExecutionContext,
    private readonly recordService: RecordService,
    @Inject(MODEL_PORT) private readonly modelPort: IModelPort,
    @SecretsConfig() private readonly secretsConfig: ISecretsConfig
  ) {}

  async get(actorUserId: string): Promise<IAgentStatusVo> {
    const view = await this.installation.status();
    const models = view.enabled && view.status === 'ok' ? await this.models(view, actorUserId) : [];
    return {
      enabled: view.enabled,
      status: view.status,
      spaceId: view.spaceId,
      baseId: view.baseId,
      tables: view.tableMap,
      lastVerifiedTime: view.lastVerifiedTime,
      lastError: view.lastError,
      health: view.health,
      models,
      warnings: buildWarnings(view, models, Boolean(this.secretsConfig.encryptionKey)),
    };
  }

  private async models(
    view: IAgentInstallationView,
    actorUserId: string
  ): Promise<IAgentModelStatus[]> {
    const tableId = view.tableMap[AGENT_TABLES.setup];
    const fields = view.fieldMap[AGENT_TABLES.setup] ?? {};
    const { records } = await this.execution.run({ runId: 'status', actorUserId }, () =>
      this.recordService.getRecords(tableId, { fieldKeyType: FieldKeyType.Id, take: 100 })
    );
    // back to pack keys, so renamed columns do not matter
    const rows = records.map((r) =>
      Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, r.fields[id]]))
    );
    const setup = pickDefaultSetup(rows) ?? {};
    return Promise.all(
      MODEL_SLOTS.map(async (slot): Promise<IAgentModelStatus> => {
        const raw = setup[slot];
        const ref = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
        if (!ref) return { slot, ref: null, ok: false };
        try {
          await this.modelPort.resolve(ref);
          return { slot, ref, ok: true };
        } catch (error) {
          return { slot, ref, ok: false, error: (error as Error).message };
        }
      })
    );
  }
}
