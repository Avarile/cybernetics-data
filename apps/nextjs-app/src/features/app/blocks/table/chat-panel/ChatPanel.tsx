import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aiGenerateStream,
  deleteAiThread,
  deleteChatFile,
  getAiThreadMessages,
  getSignature,
  listChatFiles,
  notify,
  saveChatFile,
  UploadType,
} from '@teable/openapi';
import type { IAiThreadMessage, IChatFileVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { useIsTouchDevice, useSession } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import axios from 'axios';
import { useTranslation } from 'next-i18next';
import { Resizable } from 're-resizable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptInputMessage } from '../../../../../components/ai-elements/prompt-input';
import { useChatPanelStore } from '../../../components/sidebar/useChatPanelStore';
import { useGridSearchStore } from '../../view/grid/useGridSearchStore';
import {
  ChatConversation,
  ChatFilesTab,
  ChatInputArea,
  ChatPanelHeader,
  ChatPanelTabs,
  ContextBar,
} from './components';
import { countSelectedRows, loadStoredMessages, readStream } from './helpers';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MASTRA_AGENTS,
  MAX_FILE_SIZE,
  PANEL_DEFAULT_WIDTH,
} from './types';
import type { IGridSelection, IMessage, IUploadingFile } from './types';

interface IChatPanelProps {
  baseId: string;
}

export const ChatPanel = ({ baseId }: IChatPanelProps) => {
  const { status, close, toggleExpanded } = useChatPanelStore();
  const { t } = useTranslation('common');
  const isTouchDevice = useIsTouchDevice();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const userId = user?.id;

  const [activeTab, setActiveTab] = useState<'chat' | 'files'>('chat');
  const [messages, setMessages] = useState<IMessage[]>(() => loadStoredMessages(baseId));
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [contextDismissed, setContextDismissed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const abortRef = useRef<AbortController | null>(null);

  // Mastra agent + thread state
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(`chat-agent:${baseId}`) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const hasRestoredThreadRef = useRef(false);

  const [uploadingFiles, setUploadingFiles] = useState<IUploadingFile[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  const { data: gridSelection } = useQuery<IGridSelection | null>({
    queryKey: ReactQueryKeys.gridSelection(baseId),
    queryFn: () => Promise.resolve(null),
    staleTime: Infinity,
    initialData: null,
  });

  const recordMap = useGridSearchStore((state) => state.recordMap);
  const fields = useGridSearchStore((state) => state.fields);

  const { data: chatFiles = [], refetch: refetchFiles } = useQuery<IChatFileVo[]>({
    queryKey: ['chatFiles', baseId],
    queryFn: () => listChatFiles(baseId).then((r) => r.data),
    enabled: status !== 'close',
  });

  const selectedRowCount = countSelectedRows(gridSelection, contextDismissed);

  const selectedRecordsContext = useMemo(() => {
    if (!gridSelection?.addToChat || contextDismissed || !gridSelection.rows) return '';
    if (!recordMap || !fields || fields.length === 0) return '';

    const header = fields.map((f) => f.name).join(' | ');
    const rows = gridSelection.rows
      .flatMap(([start, end]) =>
        Array.from({ length: end - start + 1 }, (_, i) => {
          const record = recordMap[start + i];
          if (!record) return null;
          return fields.map((f) => f.cellValue2String(record.fields[f.id])).join(' | ');
        })
      )
      .filter(Boolean);

    if (rows.length === 0) return '';
    return `${header}\n${rows.join('\n')}`;
  }, [gridSelection, contextDismissed, recordMap, fields]);

  useEffect(() => {
    if (gridSelection?.addToChat) {
      setContextDismissed(false);
    }
  }, [gridSelection?.timestamp, gridSelection?.addToChat]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Restore thread from localStorage once userId is available (runs once per session)
  useEffect(() => {
    if (!userId || hasRestoredThreadRef.current) return;
    hasRestoredThreadRef.current = true;
    if (!selectedAgentId) return;

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(`chat-thread:${baseId}:${userId}`);
    } catch {
      return; // localStorage unavailable
    }
    if (!stored) return;

    setThreadId(stored);
    const divider: IMessage = {
      role: 'assistant',
      content: t('ai.chat.resumedSession', '↩ Resumed previous session'),
      isDivider: true,
    };

    // Hydrate prior messages from Mastra memory (M3); fall back to just the divider.
    void (async () => {
      try {
        const res = await getAiThreadMessages(baseId, stored, selectedAgentId);
        if (!res.ok) {
          setMessages([divider]);
          return;
        }
        const history = (await res.json()) as IAiThreadMessage[];
        const mapped: IMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
        setMessages([...mapped, divider]);
      } catch {
        setMessages([divider]);
      }
    })();
  }, [baseId, userId, selectedAgentId, t]);

  // Persist selectedAgentId to localStorage
  useEffect(() => {
    try {
      if (selectedAgentId) {
        localStorage.setItem(`chat-agent:${baseId}`, selectedAgentId);
      } else {
        localStorage.removeItem(`chat-agent:${baseId}`);
      }
    } catch {
      // localStorage unavailable
    }
  }, [baseId, selectedAgentId]);

  // Persist threadId to localStorage
  useEffect(() => {
    if (!userId || !threadId) return;
    try {
      localStorage.setItem(`chat-thread:${baseId}:${userId}`, threadId);
    } catch {
      // localStorage unavailable
    }
  }, [baseId, threadId, userId]);

  // Don't save Mastra conversations to localStorage (they live in Mastra memory server-side)
  useEffect(() => {
    if (isStreaming || selectedAgentId) return;
    try {
      localStorage.setItem(`chat-history:${baseId}`, JSON.stringify(messages));
    } catch {
      // localStorage unavailable or quota exceeded
    }
  }, [baseId, messages, isStreaming, selectedAgentId]);

  // ---------------------------------------------------------------------------
  // File upload
  // ---------------------------------------------------------------------------

  const uploadFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        setUploadError(`File type not allowed. Supported: PDF, TXT, Markdown, HTML, CSV, Word.`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`File "${file.name}" exceeds 10 MB limit.`);
        return;
      }

      const tempId = `${Date.now()}-${file.name}`;
      setUploadingFiles((prev) => [...prev, { id: tempId, name: file.name, uploading: true }]);
      setUploadError(null);

      try {
        const sigRes = await getSignature({
          type: UploadType.ChatFile,
          contentLength: file.size,
          contentType: file.type,
          baseId,
        });
        const { url, uploadMethod, token, requestHeaders } = sigRes.data;

        const headers = { ...(requestHeaders as Record<string, string>) };
        delete headers['Content-Length'];
        await axios({ method: uploadMethod, url, data: file, headers });

        const notifyRes = await notify(token, undefined, file.name);
        const { path, size, mimetype } = notifyRes.data;

        await saveChatFile(baseId, { token, name: file.name, size, mimetype, path });

        setUploadingFiles((prev) =>
          prev.map((f) => (f.id === tempId ? { ...f, uploading: false, token } : f))
        );

        void refetchFiles();
      } catch {
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === tempId ? { ...f, uploading: false, error: 'Upload failed' } : f
          )
        );
      }
    },
    [baseId, refetchFiles]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.currentTarget.files;
      if (!files) return;
      for (const file of files) {
        void uploadFile(file);
      }
      e.currentTarget.value = '';
    },
    [uploadFile]
  );

  const removeUploadingFile = useCallback((id: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const toggleFileSelection = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const selectedFiles = useMemo(
    () => chatFiles.filter((f) => selectedFileIds.has(f.id)),
    [chatFiles, selectedFileIds]
  );

  // ---------------------------------------------------------------------------
  // AI streaming
  // ---------------------------------------------------------------------------

  const streamAssistantReply = useCallback(
    async (_userText: string, history: IMessage[], fileTokens: string[]) => {
      const controller = new AbortController();
      abortRef.current = controller;

      // Filter out divider messages — they're UI-only and must not be sent to the API
      const chatHistory = history.filter((m) => !m.isDivider);

      const apiMessages = chatHistory.map((m, i) => {
        if (i === chatHistory.length - 1 && m.role === 'user' && selectedRecordsContext) {
          return {
            role: m.role,
            content: `The user has selected these records from the table:\n\n${selectedRecordsContext}\n\n${m.content}`,
          };
        }
        return { role: m.role, content: m.content };
      });

      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      // \x00 is the separator emitted by the backend between reasoning and final answer.
      const SEPARATOR = '\x00';
      let answerMode = false;

      const appendChunk = (chunk: string) => {
        setIsThinking(false);

        const sepIdx = chunk.indexOf(SEPARATOR);
        if (sepIdx !== -1) {
          const reasoningPart = chunk.slice(0, sepIdx);
          const answerPart = chunk.slice(sepIdx + 1);
          answerMode = true;
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            if (reasoningPart) last.reasoning = (last.reasoning ?? '') + reasoningPart;
            if (answerPart) last.content = last.content + answerPart;
            updated[updated.length - 1] = last;
            return updated;
          });
        } else if (answerMode) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: updated[updated.length - 1].content + chunk,
            };
            return updated;
          });
        } else {
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            last.reasoning = (last.reasoning ?? '') + chunk;
            updated[updated.length - 1] = last;
            return updated;
          });
        }
      };

      try {
        const res = await aiGenerateStream(
          baseId,
          {
            messages: apiMessages,
            fileTokens: fileTokens.length ? fileTokens : undefined,
            // resourceId is derived server-side from the authenticated session;
            // the client no longer sends it (prevents memory hijacking — H1).
            ...(selectedAgentId && userId
              ? {
                  agentId: selectedAgentId,
                  ...(threadId ? { threadId } : {}),
                }
              : {}),
          },
          controller.signal
        );
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        // Capture new thread ID from header (only emitted when a new thread was created)
        const newThreadId = res.headers.get('X-Thread-Id');
        if (newThreadId) {
          setThreadId(newThreadId);
        }

        reader = res.body.getReader();
        await readStream(reader, appendChunk);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && !last.content) return prev.slice(0, -1);
            return prev;
          });
        } else {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: t('ai.chat.errorMessage', 'Something went wrong. Please try again.'),
            };
            return updated;
          });
        }
      } finally {
        reader?.cancel();
        setIsStreaming(false);
        setIsThinking(false);
        abortRef.current = null;
      }
    },
    [selectedRecordsContext, baseId, t, selectedAgentId, userId, threadId]
  );

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || isStreaming) return;

      const persistedTokens = chatFiles
        .filter((f) => selectedFileIds.has(f.id))
        .map((f) => f.token);
      const uploadingTokens = uploadingFiles
        .filter((f) => !f.uploading && !f.error && f.token)
        .map((f) => f.token as string);
      const fileTokens = [...new Set([...persistedTokens, ...uploadingTokens])];

      const userMsg: IMessage = { role: 'user', content: text };
      const assistantPlaceholder: IMessage = { role: 'assistant', content: '' };
      const nextHistory = [...messages, userMsg];

      setMessages([...nextHistory, assistantPlaceholder]);
      setIsStreaming(true);
      setIsThinking(true);
      streamAssistantReply(text, nextHistory, fileTokens);
      setUploadingFiles([]);
    },
    [isStreaming, messages, streamAssistantReply, uploadingFiles, chatFiles, selectedFileIds]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClearSession = useCallback(async () => {
    abortRef.current?.abort();

    if (threadId) {
      try {
        await deleteAiThread(baseId, threadId, selectedAgentId);
      } catch {
        // best-effort — clear locally regardless
      }
      setThreadId(undefined);
      if (userId) {
        try {
          localStorage.removeItem(`chat-thread:${baseId}:${userId}`);
        } catch {
          // ignore
        }
      }
    } else {
      try {
        localStorage.removeItem(`chat-history:${baseId}`);
      } catch {
        // localStorage unavailable
      }
    }

    setMessages([]);
    setIsStreaming(false);
    setIsThinking(false);
  }, [baseId, threadId, userId, selectedAgentId]);

  const handleAgentChange = useCallback(
    (agentId: string | undefined) => {
      setSelectedAgentId(agentId);
      // Switching agents starts a fresh session
      setThreadId(undefined);
      setMessages([]);
      if (userId) {
        try {
          localStorage.removeItem(`chat-thread:${baseId}:${userId}`);
        } catch {
          // ignore
        }
      }
      if (!agentId) {
        // Switching back to local — restore local message history
        setMessages(loadStoredMessages(baseId));
      }
    },
    [baseId, userId]
  );

  const lastAssistantMessage = useMemo(() => {
    const last = messages[messages.length - 1];
    return last?.role === 'assistant' ? last.content : '';
  }, [messages]);

  const agentLabel = useMemo(
    () => MASTRA_AGENTS.find((a) => a.id === selectedAgentId)?.label,
    [selectedAgentId]
  );

  // ---------------------------------------------------------------------------
  // File delete
  // ---------------------------------------------------------------------------

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      await deleteChatFile(baseId, fileId);
      void queryClient.invalidateQueries({ queryKey: ['chatFiles', baseId] });
    },
    [baseId, queryClient]
  );

  if (status === 'close') return null;

  const isFullscreen = status === 'expanded';

  const panelContent = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      <ChatPanelHeader
        status={status as 'open' | 'expanded'}
        isTouchDevice={isTouchDevice}
        onClose={close}
        onToggleExpanded={toggleExpanded}
        onClearSession={handleClearSession}
        agentLabel={agentLabel}
        onClearAgent={agentLabel ? () => handleAgentChange(undefined) : undefined}
      />

      <ChatPanelTabs
        activeTab={activeTab}
        fileCount={chatFiles.length}
        onTabChange={setActiveTab}
      />

      {activeTab === 'chat' && (
        <ContextBar rowCount={selectedRowCount} onDismiss={() => setContextDismissed(true)} />
      )}

      {activeTab === 'chat' && (
        <>
          <ChatConversation messages={messages} isStreaming={isStreaming} isThinking={isThinking} />
          <ChatInputArea
            baseId={baseId}
            isFullscreen={isFullscreen}
            isStreaming={isStreaming}
            lastAssistantMessage={lastAssistantMessage}
            chatFiles={chatFiles}
            selectedFileIds={selectedFileIds}
            selectedFiles={selectedFiles}
            uploadingFiles={uploadingFiles}
            uploadError={uploadError}
            selectedAgentId={selectedAgentId}
            onSubmit={handleSubmit}
            onStop={handleStop}
            onAttachClick={() => fileInputRef.current?.click()}
            onToggleFileSelection={toggleFileSelection}
            onRemoveUploadingFile={removeUploadingFile}
            onAgentChange={handleAgentChange}
          />
        </>
      )}

      {activeTab === 'files' && (
        <ChatFilesTab
          files={chatFiles}
          onDelete={handleDeleteFile}
          onUploadClick={() => fileInputRef.current?.click()}
        />
      )}
    </>
  );

  if (isTouchDevice) {
    return (
      <div className={cn('fixed inset-0 z-50 flex flex-col bg-background')}>{panelContent}</div>
    );
  }

  return (
    <Resizable
      className="ml-1 flex flex-col bg-background"
      size={{ width: isFullscreen ? '100%' : panelWidth, height: '100%' }}
      maxWidth={isFullscreen ? '100%' : '60%'}
      minWidth="280px"
      enable={{ left: !isFullscreen }}
      handleClasses={{ left: 'group' }}
      handleStyles={{ left: { width: '4px', left: '0' } }}
      handleComponent={{
        left: (
          <div className="h-full w-px bg-border group-hover:px-[1.5px] group-active:px-[1.5px]" />
        ),
      }}
      onResizeStop={(_e, _dir, _ref, d) => {
        setPanelWidth((prev) => prev + d.width);
      }}
    >
      {panelContent}
    </Resizable>
  );
};
