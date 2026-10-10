import { Check, Paperclip, X } from '@teable/icons';
import type { IChatFileVo } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { Bot, FileIcon, Files } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorTrigger,
} from '../../../../../../components/ai-elements/model-selector';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
} from '../../../../../../components/ai-elements/prompt-input';
import { formatBytes } from '../helpers';
import { MASTRA_AGENTS } from '../types';
import type { IUploadingFile } from '../types';
import { VoiceParser } from './VoiceParser';

interface IChatInputAreaProps {
  baseId: string;
  isFullscreen: boolean;
  isStreaming: boolean;
  lastAssistantMessage: string;
  chatFiles: IChatFileVo[];
  selectedFileIds: Set<string>;
  selectedFiles: IChatFileVo[];
  uploadingFiles: IUploadingFile[];
  uploadError: string | null;
  selectedAgentId: string | undefined;
  onSubmit: (
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    message: import('../../../../../../components/ai-elements/prompt-input').PromptInputMessage
  ) => void;
  onStop: () => void;
  onAttachClick: () => void;
  onToggleFileSelection: (fileId: string) => void;
  onRemoveUploadingFile: (id: string) => void;
  onAgentChange: (agentId: string | undefined) => void;
}

// Inner component — has access to PromptInputProvider context for hasText derivation
const ChatInputAreaContent = ({
  baseId,
  isFullscreen,
  isStreaming,
  lastAssistantMessage,
  chatFiles,
  selectedFileIds,
  selectedFiles,
  uploadingFiles,
  uploadError,
  selectedAgentId,
  onSubmit,
  onStop,
  onAttachClick,
  onToggleFileSelection,
  onRemoveUploadingFile,
  onAgentChange,
}: IChatInputAreaProps) => {
  const { t } = useTranslation('common');
  const controller = usePromptInputController();
  const hasText = controller.textInput.value.trim().length > 0;
  const isUploading = uploadingFiles.some((f) => f.uploading);

  return (
    <div className={isFullscreen ? 'flex shrink-0 justify-center p-3' : 'shrink-0 p-3'}>
      <PromptInput
        className={cn('[&_[data-slot=input-group]]:rounded-2xl', isFullscreen && 'w-1/3')}
        onSubmit={onSubmit}
      >
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={t('ai.chat.inputPlaceholder', 'Ask a question… (Enter to send)')}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <VoiceParser
              baseId={baseId}
              isStreaming={isStreaming}
              lastAssistantMessage={lastAssistantMessage}
            />
            <PromptInputButton
              tooltip={t('ai.chat.attachFile', 'Attach file')}
              aria-label={t('ai.chat.attachFile', 'Attach file')}
              onClick={onAttachClick}
            >
              <Paperclip className="size-4" />
            </PromptInputButton>

            <PromptInputSelect
              value={selectedAgentId ?? 'local'}
              onValueChange={(v) => onAgentChange(v === 'local' ? undefined : v)}
            >
              <PromptInputSelectTrigger
                className="h-auto gap-0.5 px-1.5 py-0.5 text-xs"
                aria-label={t('ai.chat.selectAgent', 'Select agent')}
              >
                <Bot className="size-3.5 shrink-0" />
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                <PromptInputSelectItem value="local">
                  {t('ai.chat.agentLocal', 'Local AI')}
                </PromptInputSelectItem>
                {MASTRA_AGENTS.map((agent) => (
                  <PromptInputSelectItem key={agent.id} value={agent.id}>
                    {t(agent.labelKey, agent.label)}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>

            {chatFiles.length > 0 && (
              <ModelSelector>
                <ModelSelectorTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Files className="size-3.5 shrink-0" />
                    <span>{t('ai.chat.files', 'Files')}</span>
                    {selectedFileIds.size > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 text-primary">
                        {selectedFileIds.size}
                      </span>
                    )}
                  </button>
                </ModelSelectorTrigger>
                <ModelSelectorContent
                  title={t('ai.chat.selectFilesTitle', 'Select files as context')}
                >
                  <ModelSelectorInput placeholder={t('ai.chat.searchFiles', 'Search files…')} />
                  <ModelSelectorList>
                    <ModelSelectorEmpty>
                      {t('ai.files.empty', 'No files uploaded yet.')}
                    </ModelSelectorEmpty>
                    <ModelSelectorGroup>
                      {chatFiles.map((file) => (
                        <ModelSelectorItem
                          key={file.id}
                          value={file.name}
                          onSelect={() => onToggleFileSelection(file.id)}
                        >
                          <Check
                            className={`mr-2 size-4 shrink-0 ${
                              selectedFileIds.has(file.id) ? 'opacity-100' : 'opacity-0'
                            }`}
                          />
                          <FileIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{file.name}</span>
                          <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                            {formatBytes(file.size)}
                          </span>
                        </ModelSelectorItem>
                      ))}
                    </ModelSelectorGroup>
                  </ModelSelectorList>
                </ModelSelectorContent>
              </ModelSelector>
            )}

            {selectedFiles.map((f) => (
              <div
                key={`sel-${f.id}`}
                className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
              >
                <FileIcon className="size-3 shrink-0" />
                <span className="max-w-[100px] truncate">{f.name}</span>
                <button
                  type="button"
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label={t('ai.chat.removeFile', 'Remove {{name}}', { name: f.name })}
                  onClick={() => onToggleFileSelection(f.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}

            {uploadingFiles.map((f) => (
              <div
                key={f.id}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  f.error ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'bg-muted'
                }`}
              >
                <FileIcon className="size-3 shrink-0" />
                <span className="max-w-[100px] truncate">{f.name}</span>
                {f.uploading && (
                  <span
                    className="text-muted-foreground"
                    aria-label={t('ai.chat.uploading', 'Uploading…')}
                  >
                    …
                  </span>
                )}
                {f.error && <span>{f.error}</span>}
                <button
                  type="button"
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label={t('ai.chat.removeFile', 'Remove {{name}}', { name: f.name })}
                  onClick={() => onRemoveUploadingFile(f.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}

            {uploadError && <p className="w-full text-xs text-destructive">{uploadError}</p>}
          </div>
          <PromptInputSubmit
            disabled={!isStreaming && (!hasText || isUploading)}
            title={
              isUploading
                ? t('ai.chat.waitForUploads', 'Waiting for uploads to finish…')
                : undefined
            }
            onStop={onStop}
            status={isStreaming ? 'streaming' : 'ready'}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
};

export const ChatInputArea = (props: IChatInputAreaProps) => (
  <PromptInputProvider>
    <ChatInputAreaContent {...props} />
  </PromptInputProvider>
);
