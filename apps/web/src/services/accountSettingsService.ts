import { edge } from '@/lib/cloud';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface AvatarUploadResult {
  avatarUrl: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Không thể đọc ảnh đã chọn.'));
    reader.onerror = () => reject(new Error('Không thể đọc ảnh đã chọn.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadAccountAvatar(file: File): Promise<AvatarUploadResult> {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Ảnh đại diện phải nhỏ hơn 2 MB.');
  }
  const dataUrl = await readFileAsDataUrl(file);
  return edge<AvatarUploadResult>('upload-account-avatar', { dataUrl }, 30_000);
}

export interface RequestPasswordOtpPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface RequestPasswordOtpResult {
  sent: boolean;
  expiresAt: string;
  expiresInSeconds: number;
  cooldownSeconds: number;
}

export async function requestPasswordChangeOtp(
  payload: RequestPasswordOtpPayload,
): Promise<RequestPasswordOtpResult> {
  return edge<RequestPasswordOtpResult>(
    'change-password',
    {
      action: 'request_otp',
      ...payload,
    },
    20_000,
  );
}

export interface ConfirmPasswordChangePayload extends RequestPasswordOtpPayload {
  otp: string;
}

export async function confirmPasswordChange(
  payload: ConfirmPasswordChangePayload,
): Promise<{ updated: boolean }> {
  return edge<{ updated: boolean }>(
    'change-password',
    {
      action: 'confirm_change',
      ...payload,
    },
    20_000,
  );
}
