import { UploadType } from '@teable/openapi';
import { CanceledError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentManager } from './uploadManage';

const { getSignature, notify, axiosRequest } = vi.hoisted(() => ({
  getSignature: vi.fn(),
  notify: vi.fn(),
  axiosRequest: vi.fn(),
}));

// Mocked wholesale: the real module creates an axios instance on import.
vi.mock('@teable/openapi', () => ({
  UploadType: { Table: 1 },
  getSignature,
  notify,
}));

vi.mock('axios', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: axiosRequest,
}));

const makeFile = (id: string) => ({ id, instance: new File(['x'], `${id}.txt`) });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// The upload request resolves only when `release` is called, and rejects when aborted.
const deferUploads = () => {
  const releases: Array<() => void> = [];
  axiosRequest.mockImplementation(
    (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        releases.push(() => resolve({}));
        signal.addEventListener('abort', () => reject(new CanceledError()));
      })
  );
  return releases;
};

describe('AttachmentManager cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignature.mockResolvedValue({
      data: { url: 'u', uploadMethod: 'PUT', token: 't', requestHeaders: {} },
    });
    notify.mockResolvedValue({ data: { token: 't', size: 1 } });
  });

  it('reports a cancel of a pending task', () => {
    deferUploads();
    const manager = new AttachmentManager(1);
    const callbacks = { successCallback: vi.fn(), cancelCallback: vi.fn() };

    manager.upload([makeFile('a'), makeFile('b')], UploadType.Table, callbacks);
    manager.cancelTask('b');

    expect(callbacks.cancelCallback).toHaveBeenCalledTimes(1);
    expect(callbacks.cancelCallback.mock.calls[0][0].id).toBe('b');
  });

  it('reports a cancel of an uploading task and still completes the others', async () => {
    const releases = deferUploads();
    const manager = new AttachmentManager(3);
    const callbacks = {
      successCallback: vi.fn(),
      errorCallback: vi.fn(),
      cancelCallback: vi.fn(),
    };

    manager.upload([makeFile('a'), makeFile('b'), makeFile('c')], UploadType.Table, callbacks);
    await flush();
    manager.cancelTask('b');
    releases.forEach((release) => release());
    await flush();

    expect(callbacks.cancelCallback).toHaveBeenCalledTimes(1);
    expect(callbacks.cancelCallback.mock.calls[0][0].id).toBe('b');
    expect(callbacks.successCallback.mock.calls.map(([file]) => file.id)).toEqual(['a', 'c']);
    expect(callbacks.errorCallback).not.toHaveBeenCalled();
  });

  it('drops the result of a task cancelled during notify', async () => {
    axiosRequest.mockResolvedValue({});
    let finishNotify: () => void = () => undefined;
    notify.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishNotify = () => resolve({ data: { token: 't', size: 1 } });
        })
    );
    const manager = new AttachmentManager(1);
    const callbacks = { successCallback: vi.fn(), cancelCallback: vi.fn() };

    manager.upload([makeFile('a')], UploadType.Table, callbacks);
    await flush();
    expect(notify).toHaveBeenCalled();
    manager.cancelTask('a');
    finishNotify();
    await flush();

    expect(callbacks.successCallback).not.toHaveBeenCalled();
    expect(callbacks.cancelCallback).toHaveBeenCalledTimes(1);
  });
});

describe('AttachmentManager progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignature.mockResolvedValue({
      data: { url: 'u', uploadMethod: 'PUT', token: 't', requestHeaders: {} },
    });
    notify.mockResolvedValue({ data: { token: 't', size: 1 } });
  });

  it('falls back to the file size when the total length is unknown', async () => {
    axiosRequest.mockImplementation(
      async (
        _url: string,
        { onUploadProgress }: { onUploadProgress: (e: { loaded: number; total?: number }) => void }
      ) => {
        // File content 'xx' is 2 bytes
        onUploadProgress({ loaded: 1 });
        onUploadProgress({ loaded: 2, total: 0 });
        onUploadProgress({ loaded: 3, total: 2 });
        return {};
      }
    );
    const manager = new AttachmentManager(1);
    const progressCallback = vi.fn();

    manager.upload([{ id: 'a', instance: new File(['xx'], 'a.txt') }], UploadType.Table, {
      progressCallback,
    });
    await flush();

    expect(progressCallback.mock.calls.map(([, progress]) => progress)).toEqual([50, 100, 100]);
  });
});
