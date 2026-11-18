export interface ExamAutosaveSnapshot {
  attemptId: string;
  studentId: string;
  revision: number;
  answers: Record<string, string[]>;
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  updatedAt: number;
}

export interface PendingExamMutation extends ExamAutosaveSnapshot {
  mutationId: string;
  clientSequence: number;
  writerSessionId: string;
  retryCount: number;
  status: 'queued' | 'sending';
  leaseUntil?: number;
}

export interface StoredExamAutosave {
  attemptId: string;
  nextSequence: number;
  draft?: PendingExamMutation;
  mutations: PendingExamMutation[];
}

const DATABASE_NAME = 'qizzone-exam-autosave';
const DATABASE_VERSION = 1;
const STORE_NAME = 'attempts';
const SENDING_LEASE_MS = 5_000;
let databasePromise: Promise<IDBDatabase> | undefined;
let fallbackWriterSessionId: string | undefined;
const writerLocks = new Map<string, Promise<() => void>>();

async function acquireExamWriterLock(attemptId: string): Promise<void> {
  const existing = writerLocks.get(attemptId);
  if (existing) {
    await existing;
    return;
  }

  if (typeof window === 'undefined') return;
  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!lockManager) {
    throw new Error('Trình duyệt không hỗ trợ khóa đồng bộ bài thi giữa các thẻ. Hãy dùng phiên bản Edge, Chrome, Firefox hoặc Safari mới.');
  }

  let resolveLease!: (release: () => void) => void;
  let rejectLease!: (error: unknown) => void;
  let releaseHold!: () => void;
  const held = new Promise<void>(resolve => { releaseHold = resolve; });
  const lease = new Promise<() => void>((resolve, reject) => {
    resolveLease = resolve;
    rejectLease = reject;
  });
  writerLocks.set(attemptId, lease);

  void lockManager.request(`qizzone:exam-autosave:${attemptId}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) {
      rejectLease(new Error('Bài thi đang được mở ở một thẻ khác. Hãy tiếp tục làm bài tại thẻ đó để tránh ghi đè đáp án.'));
      return;
    }
    resolveLease(releaseHold);
    await held;
  }).catch(rejectLease);

  try {
    await lease;
  } catch (error) {
    if (writerLocks.get(attemptId) === lease) writerLocks.delete(attemptId);
    throw error;
  }
}

async function releaseExamWriterLock(attemptId: string): Promise<void> {
  const lease = writerLocks.get(attemptId);
  if (!lease) return;
  try {
    const release = await lease;
    release();
  } catch {
    // A lock that could not be acquired needs no release.
  }
  if (writerLocks.get(attemptId) === lease) writerLocks.delete(attemptId);
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new Error('Trình duyệt không hỗ trợ lưu nháp bằng IndexedDB.'));
      return;
    }

    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'attemptId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không thể mở kho lưu nháp.'));
    request.onblocked = () => reject(new Error('Kho lưu nháp đang được dùng ở một thẻ khác.'));
  });
  databasePromise = opening.catch((error: unknown): never => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không thể truy cập kho lưu nháp.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Giao dịch lưu nháp đã bị hủy.'));
    transaction.onerror = () => reject(transaction.error || new Error('Giao dịch lưu nháp thất bại.'));
  });
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    return (token === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function getWriterSessionId(): string {
  try {
    const storage = typeof window === 'undefined' ? undefined : window.sessionStorage;
    const existing = storage?.getItem('qizzone:exam-writer-session');
    if (existing) return existing;
    const created = createId();
    storage?.setItem('qizzone:exam-writer-session', created);
    return created;
  } catch {
    fallbackWriterSessionId ??= createId();
    return fallbackWriterSessionId;
  }
}

export async function persistExamSnapshot(
  snapshot: ExamAutosaveSnapshot,
  writerSessionId = getWriterSessionId(),
): Promise<PendingExamMutation> {
  await acquireExamWriterLock(snapshot.attemptId);
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const existing = await requestResult(store.get(snapshot.attemptId) as IDBRequest<StoredExamAutosave | undefined>);
  const nextSequence = (existing?.nextSequence || 0) + 1;
  const mutation: PendingExamMutation = {
    ...snapshot,
    mutationId: createId(),
    clientSequence: nextSequence,
    writerSessionId,
    retryCount: 0,
    status: 'queued',
  };
  const mutations = (existing?.mutations || [])
    .filter(item => item.status === 'sending')
    .map(item => (item.leaseUntil || 0) <= Date.now()
      ? { ...item, status: 'queued' as const, leaseUntil: undefined }
      : item);
  mutations.push(mutation);
  store.put({
    attemptId: snapshot.attemptId,
    nextSequence,
    draft: mutation,
    mutations,
  } satisfies StoredExamAutosave);
  await done;
  return mutation;
}

export async function readExamAutosave(attemptId: string): Promise<StoredExamAutosave | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(transaction);
  const record = await requestResult(transaction.objectStore(STORE_NAME).get(attemptId) as IDBRequest<StoredExamAutosave | undefined>);
  await done;
  return record;
}

export async function reserveNextExamMutation(attemptId: string): Promise<PendingExamMutation | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const record = await requestResult(store.get(attemptId) as IDBRequest<StoredExamAutosave | undefined>);
  if (!record) {
    await done;
    return undefined;
  }

  const now = Date.now();
  const inFlight = record.mutations.find(item => item.status === 'sending' && (item.leaseUntil || 0) > now);
  if (inFlight) {
    await done;
    return undefined;
  }

  const candidate = [...record.mutations]
    .filter(item => item.status === 'queued' || (item.status === 'sending' && (item.leaseUntil || 0) <= now))
    .sort((left, right) => left.clientSequence - right.clientSequence)[0];
  if (!candidate) {
    await done;
    return undefined;
  }

  const reserved = { ...candidate, status: 'sending' as const, leaseUntil: now + SENDING_LEASE_MS };
  record.mutations = record.mutations.map(item => item.mutationId === candidate.mutationId ? reserved : item);
  store.put(record);
  await done;
  return reserved;
}

export async function retryExamMutation(mutationId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const records = await requestResult(store.getAll() as IDBRequest<StoredExamAutosave[]>);
  const record = records.find(item => item.mutations.some(mutation => mutation.mutationId === mutationId));
  if (record) {
    record.mutations = record.mutations.map(item => item.mutationId === mutationId
      ? { ...item, status: 'queued', retryCount: item.retryCount + 1, leaseUntil: undefined }
      : item);
    store.put(record);
  }
  await done;
}

export async function acknowledgeExamMutation(mutationId: string, serverRevision: number): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const records = await requestResult(store.getAll() as IDBRequest<StoredExamAutosave[]>);
  const record = records.find(item => item.mutations.some(mutation => mutation.mutationId === mutationId));
  if (!record) {
    await done;
    return;
  }

  const acknowledged = record.mutations.find(item => item.mutationId === mutationId)!;
  record.mutations = record.mutations.filter(item => item.mutationId !== mutationId);
  const hasNewerDraft = Boolean(record.draft && record.draft.clientSequence > acknowledged.clientSequence);
  if (!hasNewerDraft && record.mutations.length === 0) {
    record.draft = undefined;
    store.put(record);
  } else {
    if (record.draft) record.draft = { ...record.draft, revision: serverRevision };
    record.mutations = record.mutations.map(item => item.status === 'queued' && item.clientSequence > acknowledged.clientSequence
      ? { ...item, revision: serverRevision }
      : item);
    store.put(record);
  }
  await done;
}

export async function clearExamAutosave(attemptId: string): Promise<void> {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(attemptId);
    await done;
  } finally {
    await releaseExamWriterLock(attemptId);
  }
}

export async function releaseExamAutosaveWriter(attemptId: string): Promise<void> {
  await releaseExamWriterLock(attemptId);
}
