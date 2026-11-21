import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  edge: vi.fn(),
}));

vi.mock('@/lib/cloud', () => ({
  edge: mocks.edge,
}));

import { uploadMaterialToR2 } from '@/services/materialUploadService';

function makeValidPdfFile(name: string, sizeBytes: number): File {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  return {
    name,
    size: sizeBytes,
    type: 'application/pdf',
    slice: (start = 0, end = header.length) =>
      ({
        arrayBuffer: async () => header.slice(start, Math.min(end, header.length)).buffer,
      }) as Blob,
    arrayBuffer: async () => header.buffer,
  } as unknown as File;
}

describe('Cloudflare R2 direct upload adapter (T04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects files exceeding 50 MiB and invalid magic-byte signatures before contacting Edge', async () => {
    const oversized = makeValidPdfFile('huge.pdf', 50 * 1024 * 1024 + 1);
    await expect(uploadMaterialToR2(oversized)).rejects.toThrow(/50 MB/i);
    expect(mocks.edge).not.toHaveBeenCalled();

    const spoofedPdf = {
      name: 'fake.pdf',
      size: 2048,
      type: 'application/pdf',
      slice: () => ({ arrayBuffer: async () => new Uint8Array([0x4d, 0x5a, 0x90, 0x00]).buffer }),
    } as unknown as File;
    await expect(uploadMaterialToR2(spoofedPdf)).rejects.toThrow(/không phải PDF hợp lệ/i);
    expect(mocks.edge).not.toHaveBeenCalled();
  });

  it.each([2, 5, 10, 20, 50])(
    'uploads %d MiB PDF directly to presigned R2 URL without passing bytes through Edge',
    async sizeMb => {
      const sizeBytes = sizeMb * 1024 * 1024;
      const file = makeValidPdfFile(`exam-${sizeMb}mb.pdf`, sizeBytes);
      const materialId = `550e8400-e29b-41d4-a716-44665544000${sizeMb % 10}`;
      const putUrl = 'https://account.r2.cloudflarestorage.com/qizzone-materials/obj?X-Amz-Signature=abc';

      mocks.edge
        .mockResolvedValueOnce({
          materialId,
          objectKey: `materials/u1/${materialId}-exam.pdf`,
          putUrl,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        })
        .mockResolvedValueOnce({
          status: 'ready',
          sizeBytes,
          mimeType: 'application/pdf',
        });

      const xhrMock = {
        open: vi.fn(),
        setRequestHeader: vi.fn(),
        send: vi.fn(function (this: { onload?: () => void; status: number; upload: { onprogress?: (e: ProgressEvent) => void } }) {
          this.upload.onprogress?.({ lengthComputable: true, loaded: sizeBytes, total: sizeBytes } as ProgressEvent);
          this.status = 200;
          this.onload?.();
        }),
        abort: vi.fn(),
        upload: {} as { onprogress?: (e: ProgressEvent) => void },
        status: 0,
      };
      vi.stubGlobal('XMLHttpRequest', vi.fn(function () { return xhrMock; }));

      const progressEvents: number[] = [];
      const result = await uploadMaterialToR2(file, {
        onProgress: p => progressEvents.push(p.percent),
      });

      expect(result).toMatchObject({ materialId, sizeBytes, mimeType: 'application/pdf' });
      expect(progressEvents).toContain(100);
      expect(mocks.edge).toHaveBeenNthCalledWith(
        1,
        'create-upload-url',
        expect.objectContaining({ fileName: `exam-${sizeMb}mb.pdf`, sizeBytes }),
        15_000,
      );
      expect(xhrMock.open).toHaveBeenCalledWith('PUT', putUrl, true);
      expect(mocks.edge).toHaveBeenNthCalledWith(2, 'confirm-upload', { materialId }, 15_000);
      vi.unstubAllGlobals();
    },
  );

  it('handles expired presigned URLs (HTTP 403) and user cancellation', async () => {
    const file = makeValidPdfFile('expired.pdf', 2 * 1024 * 1024);
    mocks.edge.mockResolvedValueOnce({
      materialId: '550e8400-e29b-41d4-a716-446655440099',
      objectKey: 'materials/u1/expired.pdf',
      putUrl: 'https://account.r2.cloudflarestorage.com/expired',
      expiresAt: new Date().toISOString(),
    });

    const xhr403 = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(function (this: { onload?: () => void; status: number }) {
        this.status = 403;
        this.onload?.();
      }),
      abort: vi.fn(),
      upload: {},
      status: 0,
    };
    vi.stubGlobal('XMLHttpRequest', vi.fn(function () { return xhr403; }));

    await expect(uploadMaterialToR2(file)).rejects.toThrow(/hết hạn|không hợp lệ/i);
    vi.unstubAllGlobals();

    const controller = new AbortController();
    controller.abort();
    mocks.edge.mockResolvedValueOnce({
      materialId: '550e8400-e29b-41d4-a716-446655440098',
      objectKey: 'materials/u1/aborted.pdf',
      putUrl: 'https://account.r2.cloudflarestorage.com/aborted',
      expiresAt: new Date().toISOString(),
    });
    await expect(uploadMaterialToR2(file, { signal: controller.signal })).rejects.toThrow(/aborted|hủy/i);
  });
});
