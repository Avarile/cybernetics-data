import type { HttpError } from '@cybernetics/core';
import type { IAiProviderVo, IGatewayModel, ITestAiProviderModelsVo } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { GatewayModelsStep } from '../../setting/components/ai-config/GatewayModelsStep';
import { HeadersEditor } from './HeadersEditor';
import type { IProviderPreset } from './presets';
import { PROVIDER_PRESETS } from './presets';
import type { IProviderFormState } from './provider-form';
import {
  duplicateState,
  hasErrors,
  stateFromPreset,
  stateFromProvider,
  toCreateRo,
  toTestDraft,
  toUpdateRo,
  validateState,
} from './provider-form';
import { ConnectionStep } from './steps/ConnectionStep';
import { ModelsStep } from './steps/ModelsStep';
import { PresetStep } from './steps/PresetStep';
import { useProviderMutations } from './useProviders';

export type IProviderSheetMode =
  | { kind: 'add'; preset?: IProviderPreset }
  | { kind: 'edit'; provider: IAiProviderVo }
  | { kind: 'duplicate'; provider: IAiProviderVo };

interface IProviderSheetProps {
  mode: IProviderSheetMode | null;
  onClose: () => void;
  takenIds: string[];
  gatewayModels: IGatewayModel[];
  onGatewayModelsChange: (models: IGatewayModel[]) => void;
}

type IModelResult = ITestAiProviderModelsVo['results'][number];

const initialState = (mode: IProviderSheetMode, takenIds: string[]) => {
  if (mode.kind === 'edit') return stateFromProvider(mode.provider);
  if (mode.kind === 'duplicate') return duplicateState(mode.provider, takenIds);
  return mode.preset ? stateFromPreset(mode.preset, takenIds) : undefined;
};

/** Add (preset → connection → models) or edit (tabs) one provider. Keys never come back. */
export const ProviderSheet = (props: IProviderSheetProps) => {
  const { mode, onClose, takenIds, gatewayModels, onGatewayModelsChange } = props;
  const { t } = useTranslation('common');
  const { create, update, test, testModels, fetchModels } = useProviderMutations();

  const [state, setState] = useState<IProviderFormState | undefined>();
  const [preset, setPreset] = useState<IProviderPreset | undefined>();
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState('connection');
  const [dirty, setDirty] = useState(false);
  // Field errors show after the first save attempt, not while the admin is still typing.
  const [submitted, setSubmitted] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, IModelResult>>({});

  const editing = mode?.kind === 'edit' ? mode.provider : undefined;
  const creating = !editing;
  const isGateway = state?.type === LLMProviderType.AI_GATEWAY;

  useEffect(() => {
    if (!mode) return;
    const next = initialState(mode, takenIds);
    setState(next);
    setPreset(
      mode.kind === 'add'
        ? mode.preset
        : PROVIDER_PRESETS.find((p) => p.type === (mode.provider.type as LLMProviderType))
    );
    setStep(next ? 1 : 0);
    setTab('connection');
    setDirty(false);
    setSubmitted(false);
    setAvailable([]);
    setResults({});
    test.reset();
    // Re-initialise only when the sheet opens with a new mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const errors = useMemo(
    () => (state ? validateState(state, { creating, takenIds: editing ? [] : takenIds }) : {}),
    [state, creating, takenIds, editing]
  );

  const change = (next: IProviderFormState) => {
    setState(next);
    setDirty(true);
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  const runTest = async () => {
    if (!state) return;
    const res = await test.mutateAsync({
      ...(editing ? { providerId: editing.id } : {}),
      ...(editing && !dirty ? {} : { draft: toTestDraft(state) }),
    });
    if (res.models?.length) setAvailable(res.models);
  };

  const refresh = async () => {
    if (!editing) return runTest();
    const res = await fetchModels.mutateAsync(editing.id);
    setAvailable(res.models);
    if (!res.fetched && res.error) toast.error(res.error);
  };

  const runModelTests = async (models: string[]) => {
    if (!editing) return;
    const res = await testModels.mutateAsync({ id: editing.id, models });
    setResults(Object.fromEntries(res.results.map((r) => [r.model, r])));
  };

  const save = async () => {
    setSubmitted(true);
    if (!state || hasErrors(errors)) {
      setStep(1);
      setTab('connection');
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ro: toUpdateRo(state, editing) });
      } else {
        await create.mutateAsync(toCreateRo(state));
      }
      toast.success(t('admin.setting.ai.providers.saved', 'Provider saved'));
      setDirty(false);
      onClose();
    } catch (e) {
      toast.error((e as HttpError).message);
    }
  };

  const connection = state && (
    <ConnectionStep
      state={state}
      onChange={change}
      errors={submitted ? errors : {}}
      creating={creating && !isGateway}
      storedPreview={editing?.apiKeyPreview}
      headerHints={preset?.headerHints}
      baseUrlPlaceholder={preset?.baseUrl}
      onTest={runTest}
      testing={test.isPending}
      testResult={test.data}
      showHeaders={creating}
    />
  );

  const models =
    state &&
    (isGateway ? (
      <GatewayModelsStep
        gatewayModels={gatewayModels}
        onChange={onGatewayModelsChange}
        disabled={!editing}
      />
    ) : (
      <ModelsStep
        state={state}
        onChange={change}
        available={available}
        onRefresh={refresh}
        refreshing={fetchModels.isPending || test.isPending}
        canTest={Boolean(editing) && !dirty}
        onTestSelected={runModelTests}
        testing={testModels.isPending}
        results={results}
      />
    ));

  const title = editing
    ? t('admin.setting.ai.providers.editTitle', 'Edit {{name}}', { name: editing.name })
    : t('admin.setting.ai.providers.addTitle', 'Add provider');

  return (
    <>
      <Sheet open={Boolean(mode)} onOpenChange={(open) => (!open ? requestClose() : undefined)}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>{String(title)}</SheetTitle>
            <SheetDescription>
              {t(
                'admin.setting.ai.providers.sheetHelp',
                'Keys are stored encrypted and are never shown again after saving.'
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1">
            {creating && step === 0 && (
              <PresetStep
                onPick={(p) => {
                  setPreset(p);
                  setState(stateFromPreset(p, takenIds));
                  setStep(1);
                  setDirty(true);
                }}
              />
            )}
            {creating && step === 1 && connection}
            {creating && step === 2 && models}
            {editing && (
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="connection">
                    {t('admin.setting.ai.providers.tabConnection', 'Connection')}
                  </TabsTrigger>
                  <TabsTrigger value="models">
                    {t('admin.setting.ai.providers.tabModels', 'Models')}
                  </TabsTrigger>
                  {!isGateway && (
                    <TabsTrigger value="advanced">
                      {t('admin.setting.ai.providers.tabAdvanced', 'Advanced')}
                    </TabsTrigger>
                  )}
                </TabsList>
                <TabsContent value="connection">{connection}</TabsContent>
                <TabsContent value="models">{models}</TabsContent>
                <TabsContent value="advanced">
                  {state && (
                    <HeadersEditor
                      rows={state.headers}
                      onChange={(headers) => change({ ...state, headers })}
                      hints={preset?.headerHints}
                    />
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>

          {(editing || step > 0) && (
            <SheetFooter className="gap-2 sm:justify-between">
              <div>
                {creating && step > 0 && (
                  <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                    {t('actions.back')}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {creating && step === 1 && !isGateway && (
                  <Button type="button" variant="outline" onClick={() => setStep(2)}>
                    {t('admin.setting.ai.providers.next', 'Next: models')}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={save}
                  disabled={create.isPending || update.isPending}
                  data-testid="provider-save"
                >
                  {t('admin.setting.ai.providers.save', 'Save provider')}
                </Button>
              </div>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('admin.setting.ai.providers.discardTitle', 'Discard changes?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'admin.setting.ai.providers.discardDesc',
                'This provider has unsaved changes. A key you typed will be lost.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                setDirty(false);
                onClose();
              }}
            >
              {t('admin.setting.ai.providers.discard', 'Discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
