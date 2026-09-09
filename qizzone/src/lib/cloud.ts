import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { createClient } from '@supabase/supabase-js';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const missingConfiguration = Object.entries({
  VITE_FIREBASE_API_KEY: config.apiKey, VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
  VITE_FIREBASE_PROJECT_ID: config.projectId, VITE_FIREBASE_APP_ID: config.appId,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
}).filter(([, value]) => !value || /YOUR_|your_|placeholder/.test(value)).map(([key]) => key);

export function firebaseAuth() {
  if (missingConfiguration.length) {
    throw new Error(`Thiếu cấu hình: ${missingConfiguration.join(', ')}. Xem hướng dẫn SETUP.md.`);
  }
  return getAuth(getApps()[0] || initializeApp(config));
}
let client: ReturnType<typeof createClient> | undefined;
export function supabase() {
  client ??= createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    accessToken: async () => (await firebaseAuth().currentUser?.getIdToken()) ?? null,
  });
  return client;
}
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const client = supabase() as unknown as {
    rpc: (functionName: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function edge<T>(name: string, body: unknown, timeoutMs = 65_000): Promise<T> {
  const token = await firebaseAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Vui lòng đăng nhập.');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as { error?: string }).error || 'Không thể kết nối dịch vụ.');
  return result as T;
}
export function errorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/email-already-in-use': 'Email đã được đăng ký. Vui lòng đăng nhập.',
    'auth/network-request-failed': 'Mất kết nối mạng. Vui lòng thử lại.',
    'auth/too-many-requests': 'Quá nhiều lần thử. Vui lòng thử lại sau.',
    'auth/weak-password': 'Mật khẩu phải có ít nhất 6 ký tự.',
    'auth/user-disabled': 'Tài khoản đã bị vô hiệu hóa.',
    'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
    'auth/operation-not-allowed': 'Đăng nhập Email/Password chưa được bật trong Firebase.',
  };
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'Dịch vụ phản hồi quá lâu. Vui lòng thử lại.';
  return (code && messages[code]) || (error instanceof Error ? error.message : 'Không thể hoàn thành thao tác.');
}
