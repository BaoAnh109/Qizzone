import type {
  ConfirmUploadResponse,
  CreateUploadUrlResponse,
} from '@qizzone/domain';
import { validateImportFileSignature, validateR2MaterialUpload } from '@qizzone/document-parser';
import { edge } from '@/lib/cloud';

export interface MaterialUploadProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface MaterialUploadOptions {
  onProgress?: (progress: MaterialUploadProgress) => void;
  signal?: AbortSignal;
}

export interface UploadedMaterialRecord {
  materialId: string;
  objectKey: string;
  sizeBytes: number;
  mimeType: string;
  sha256?: string;
}

const EXTENSION_MIME: Record<string, CreateUploadUrlResponse['objectKey']> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  md: 'text/plain',
};

function inferMaterialMime(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME[ext] || file.type || 'application/octet-stream';
}

async function computeFileSha256(file: File): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export function putToPresignedUrl(
  putUrl: string,
  file: Blob,
  contentType: string,
  options: MaterialUploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', putUrl, true);
    xhr.setRequestHeader('Content-Type', contentType);

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Đã hủy tải tệp lên.', 'AbortError'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !options.onProgress) return;
      options.onProgress({
        loadedBytes: event.loaded,
        totalBytes: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    };

    xhr.onload = () => {
      options.signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else if (xhr.status === 403) {
        reject(new Error('Liên kết tải lên R2 đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.'));
      } else {
        reject(new Error(`Tải tệp lên R2 thất bại (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new Error('Lỗi mạng khi tải tệp trực tiếp lên Cloudflare R2.'));
    };

    xhr.send(file);
  });
}

/** Direct browser -> Cloudflare R2 upload using short-lived presigned PUT URL. */
export async function uploadMaterialToR2(
  file: File,
  options: MaterialUploadOptions = {},
): Promise<UploadedMaterialRecord> {
  const sizeError = validateR2MaterialUpload(file);
  if (sizeError) throw new Error(sizeError);

  const signatureError = await validateImportFileSignature(file);
  if (signatureError) throw new Error(signatureError);

  const mimeType = inferMaterialMime(file);
  const sha256 = await computeFileSha256(file);

  const created = await edge<CreateUploadUrlResponse>(
    'create-upload-url',
    {
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      ...(sha256 ? { sha256 } : {}),
    },
    15_000,
  );

  await putToPresignedUrl(created.putUrl, file, mimeType, options);

  const confirmed = await edge<ConfirmUploadResponse>(
    'confirm-upload',
    { materialId: created.materialId },
    15_000,
  );
  if (confirmed.status !== 'ready') {
    throw new Error('Không thể xác nhận tệp đã tải lên trên kho lưu trữ.');
  }

  return {
    materialId: created.materialId,
    objectKey: created.objectKey,
    sizeBytes: confirmed.sizeBytes,
    mimeType: confirmed.mimeType,
    sha256,
  };
}
