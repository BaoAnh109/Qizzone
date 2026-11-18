import { beforeEach, describe, expect, it, vi } from 'vitest';

const { qizzoneApiMock } = vi.hoisted(() => ({ qizzoneApiMock: vi.fn() }));

vi.mock('@/lib/cloud', () => ({
  isQizzoneApiConfigured: true,
  qizzoneApi: qizzoneApiMock,
  edge: vi.fn(),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'error',
}));

import { extractQuizWithAI } from '@/services/aiExtractionService';

describe('AI import cancellation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends cancellation to the API when a teacher aborts a running job', async () => {
    qizzoneApiMock.mockImplementation((path: string, init: RequestInit = {}) => {
      if (path === '/api/v1/ai-import-jobs' && init.method === 'POST') {
        return Promise.resolve({ jobId: 'job-1', status: 'queued' });
      }
      if (path === '/api/v1/ai-import-jobs/job-1') {
        return new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
          } else {
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          }
        });
      }
      if (path === '/api/v1/ai-import-jobs/job-1/cancel' && init.method === 'POST') {
        return Promise.resolve(undefined);
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const controller = new AbortController();
    const extraction = extractQuizWithAI({
      text: 'Văn bản chưa có cấu trúc đề thi để parser chuyển trực tiếp.',
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(qizzoneApiMock).toHaveBeenCalledWith(
        '/api/v1/ai-import-jobs/job-1',
        expect.objectContaining({ signal: controller.signal }),
      );
    });
    controller.abort();

    await expect(extraction).rejects.toMatchObject({ name: 'AbortError' });
    expect(qizzoneApiMock).toHaveBeenCalledWith(
      '/api/v1/ai-import-jobs/job-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('stops immediately when the server reports a cancelled job', async () => {
    qizzoneApiMock.mockImplementation((path: string, init: RequestInit = {}) => {
      if (path === '/api/v1/ai-import-jobs' && init.method === 'POST') {
        return Promise.resolve({ jobId: 'job-2', status: 'queued' });
      }
      if (path === '/api/v1/ai-import-jobs/job-2') {
        return Promise.resolve({ jobId: 'job-2', status: 'cancelled' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await expect(extractQuizWithAI({ text: 'Văn bản chưa có cấu trúc đề thi để parser chuyển trực tiếp.' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(qizzoneApiMock).toHaveBeenCalledTimes(2);
  });
});
