import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MediaPlaceholderElement } from './media-placeholder-element';

const mocks = vi.hoisted(() => ({
  placeholderApi: {
    addUploadingFile: vi.fn(),
    removeUploadingFile: vi.fn(),
    getUploadingFile: vi.fn(),
  },
  uploadFile: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@udecode/plate/react', () => ({
  PlateElement: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useEditorPlugin: () => ({ api: { placeholder: mocks.placeholderApi } }),
  withHOC: (_provider: unknown, component: unknown) => component,
}));

vi.mock('@udecode/plate-media/react', () => ({
  AudioPlugin: { key: 'audio' },
  FilePlugin: { key: 'file' },
  ImagePlugin: { key: 'img' },
  VideoPlugin: { key: 'video' },
  PlaceholderPlugin: { key: 'placeholder' },
  PlaceholderProvider: () => null,
  updateUploadHistory: vi.fn(),
}));

vi.mock('use-file-picker', () => ({
  useFilePicker: () => ({ openFilePicker: vi.fn() }),
}));

vi.mock('./hooks/useUploadFile', () => ({
  useUploadFile: () => ({
    isUploading: false,
    progress: 0,
    uploadedFile: null,
    uploadFile: mocks.uploadFile,
    uploadingFile: null,
  }),
}));

vi.mock('@teable/ui-lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sonner: { toast: { error: mocks.toastError } },
}));

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('MediaPlaceholderElement', () => {
  it('resets the placeholder and shows a toast when the upload fails', async () => {
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    mocks.placeholderApi.getUploadingFile.mockReturnValue(file);
    mocks.uploadFile.mockRejectedValue(undefined);

    const props = {
      editor: {},
      element: { id: 'placeholder_1', mediaType: 'img', children: [{ text: '' }] },
    } as unknown as Parameters<typeof MediaPlaceholderElement>[0];
    render(<MediaPlaceholderElement {...props} />);

    await waitFor(() => {
      expect(mocks.placeholderApi.removeUploadingFile).toHaveBeenCalledWith('placeholder_1');
    });
    expect(mocks.uploadFile).toHaveBeenCalledWith(file);
    expect(mocks.toastError).toHaveBeenCalledWith('common.uploadFailed');
  });
});
