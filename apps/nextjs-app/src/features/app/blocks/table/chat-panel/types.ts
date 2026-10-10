export interface IMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  isDivider?: boolean;
  isError?: boolean;
}

// `labelKey` is resolved under the `common` namespace; `label` is the fallback.
export const MASTRA_AGENTS = [
  {
    id: 'knowledge-manager-non-rag',
    labelKey: 'ai.chat.agents.knowledge',
    label: 'Knowledge Search',
  },
  { id: 'knowledge-manager-rag', labelKey: 'ai.chat.agents.rag', label: 'RAG Search' },
] as const;

export interface IGridSelection {
  rows: [number, number][] | null;
  timestamp: number;
  addToChat?: boolean;
}

export interface IUploadingFile {
  id: string;
  name: string;
  uploading: boolean;
  error?: string;
  token?: string;
}

export const PANEL_DEFAULT_WIDTH = 320;

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

export const ALLOWED_EXTENSIONS = '.pdf,.txt,.md,.html,.htm,.csv,.docx,.doc';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
