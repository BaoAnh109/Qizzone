import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import {
  acknowledgeExamMutation,
  clearExamAutosave,
  persistExamSnapshot,
  readExamAutosave,
  reserveNextExamMutation,
} from '@/store/examAutosavePersistence';

const snapshot = (answer: string, revision = 0) => ({
  attemptId: 'attempt-persistence-test',
  studentId: 'student-1',
  revision,
  answers: { 'question-1': [answer] },
  flaggedQuestionIds: [],
  currentQuestionIndex: 0,
  updatedAt: Date.now(),
});

globalThis.indexedDB = fakeIndexedDB;

describe('exam autosave IndexedDB outbox', () => {
  afterEach(async () => {
    await clearExamAutosave('attempt-persistence-test');
  });

  it('coalesces unsent snapshots while preserving the mutation already in flight', async () => {
    const first = await persistExamSnapshot(snapshot('A'), 'writer-1');
    const sending = await reserveNextExamMutation(first.attemptId);
    expect(sending?.mutationId).toBe(first.mutationId);

    const latest = await persistExamSnapshot(snapshot('B'), 'writer-1');
    let stored = await readExamAutosave(first.attemptId);
    expect(stored?.mutations.map(item => item.mutationId)).toEqual([first.mutationId, latest.mutationId]);
    expect(stored?.draft?.answers).toEqual({ 'question-1': ['B'] });

    await acknowledgeExamMutation(first.mutationId, 1);
    stored = await readExamAutosave(first.attemptId);
    expect(stored?.mutations).toHaveLength(1);
    expect(stored?.mutations[0]).toMatchObject({
      mutationId: latest.mutationId,
      status: 'queued',
      revision: 1,
      answers: { 'question-1': ['B'] },
    });
    expect(stored?.draft?.revision).toBe(1);
  });

  it('replaces queued snapshots and retains a monotonic per-attempt sequence', async () => {
    const first = await persistExamSnapshot(snapshot('A'), 'writer-1');
    const latest = await persistExamSnapshot(snapshot('B'), 'writer-1');
    const stored = await readExamAutosave(first.attemptId);
    expect(stored?.mutations).toHaveLength(1);
    expect(stored?.mutations[0]).toMatchObject({
      mutationId: latest.mutationId,
      clientSequence: 2,
      answers: { 'question-1': ['B'] },
    });
  });

  it('refuses to write when another browser tab owns the attempt lock', async () => {
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown> | unknown) => callback(null));
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { locks: { request } });

    try {
      await expect(persistExamSnapshot(snapshot('A'), 'writer-locked-out'))
        .rejects.toThrow('Bài thi đang được mở ở một thẻ khác');
      expect(request).toHaveBeenCalledTimes(1);
      expect(await readExamAutosave('attempt-persistence-test')).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
