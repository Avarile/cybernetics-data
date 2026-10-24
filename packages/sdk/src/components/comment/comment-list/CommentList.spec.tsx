import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommentPatchType } from '@teable/openapi';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommentList } from './CommentList';

const mocks = vi.hoisted(() => ({
  patchListener: undefined as ((remoteData: unknown) => void) | undefined,
  getCommentList: vi.fn(),
}));

vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCommentList: mocks.getCommentList,
}));

vi.mock('../../../hooks', () => ({
  useSession: () => ({ user: { id: 'usr_me' } }),
}));

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./useCommentPatchListener', () => ({
  useCommentPatchListener: (_tableId: string, _recordId: string, cb: (data: unknown) => void) => {
    mocks.patchListener = cb;
  },
}));

vi.mock('./CommentItem', () => ({
  CommentItem: ({ id }: { id: string }) => <div>{id}</div>,
}));

const createComment = (id: string, createdTime: string) => ({
  id,
  createdTime,
  content: [],
  createdBy: { id: 'usr_other', name: 'Other' },
});

describe('CommentList', () => {
  it('keeps a deleted comment out of the list although loaded pages still contain it', async () => {
    mocks.getCommentList.mockResolvedValue({
      data: {
        comments: [
          createComment('com_1', '2024-01-01T00:00:00.000Z'),
          createComment('com_2', '2024-01-02T00:00:00.000Z'),
        ],
        nextCursor: null,
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommentList tableId="tbl_test" recordId="rec_test" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('com_1')).toBeInTheDocument();
    });

    act(() => {
      mocks.patchListener?.({ type: CommentPatchType.DeleteComment, data: { id: 'com_1' } });
    });

    await waitFor(() => {
      expect(screen.queryByText('com_1')).not.toBeInTheDocument();
    });
    expect(screen.getByText('com_2')).toBeInTheDocument();
  });
});
