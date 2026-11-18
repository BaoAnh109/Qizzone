import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { createClient } from '@supabase/supabase-js';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
const apiBaseUrl = import.meta.env.VITE_QIZZONE_API_BASE_URL?.trim().replace(/\/+$/, '');
export const isAllowedQizzoneApiBaseUrl = (value?: string) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    const secure = url.protocol === 'https:';
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    return (secure || localHttp) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
};
export const isQizzoneApiConfigured = isAllowedQizzoneApiBaseUrl(apiBaseUrl);
export const missingConfiguration = Object.entries({
  VITE_FIREBASE_API_KEY: config.apiKey, VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
  VITE_FIREBASE_PROJECT_ID: config.projectId, VITE_FIREBASE_APP_ID: config.appId,
  ...(!isQizzoneApiConfigured ? {
    VITE_SUPABASE_URL: supabaseConfig.url,
    VITE_SUPABASE_PUBLISHABLE_KEY: supabaseConfig.key,
  } : {}),
}).filter(([, value]) => !value || /YOUR_|your_|placeholder/.test(value)).map(([key]) => key);

export function firebaseAuth() {
  if (missingConfiguration.length) {
    throw new Error(`Thiếu cấu hình: ${missingConfiguration.join(', ')}. Xem hướng dẫn SETUP.md.`);
  }
  return getAuth(getApps()[0] || initializeApp(config));
}
let client: ReturnType<typeof createClient> | undefined;
export function supabase() {
  if (!supabaseConfig.url || !supabaseConfig.key) {
    throw new Error('Thiếu cấu hình Supabase cho tính năng chưa chuyển sang API mới.');
  }
  client ??= createClient(supabaseConfig.url, supabaseConfig.key, {
    accessToken: async () => (await firebaseAuth().currentUser?.getIdToken()) ?? null,
  });
  return client;
}
export async function qizzoneApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isQizzoneApiConfigured || !apiBaseUrl) {
    throw new Error('Thiếu VITE_QIZZONE_API_BASE_URL.');
  }
  const token = await firebaseAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Vui lòng đăng nhập.');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw error;
    throw new Error('Không thể kết nối Qizzone API. Vui lòng thử lại khi mạng ổn định.', { cause: error });
  }

  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({})) as {
    error?: string;
    detail?: string;
    title?: string;
    errors?: Record<string, string[]>;
  };
  if (!response.ok) {
    const validationMessage = result.errors
      ? Object.values(result.errors).flat().join(' ')
      : undefined;
    throw new Error(result.error || validationMessage || result.detail || result.title || `Qizzone API trả về lỗi ${response.status}.`);
  }
  return result as T;
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
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw error;
    throw new Error('Không thể kết nối tới Supabase Edge Function. Vui lòng kiểm tra cấu hình CORS và trạng thái deploy.', { cause: error });
  }
  if (response.status === 404) throw new Error(`Supabase Edge Function "${name}" chưa được deploy.`);
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
    'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập Google.',
    'auth/popup-blocked': 'Trình duyệt đã chặn cửa sổ Google. Hãy cho phép popup rồi thử lại.',
    'auth/cancelled-popup-request': 'Yêu cầu đăng nhập Google đã bị hủy. Vui lòng thử lại.',
    'auth/account-exists-with-different-credential': 'Email này đã được đăng ký bằng phương thức đăng nhập khác.',
  };
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'Dịch vụ phản hồi quá lâu. Vui lòng thử lại.';
  if (error instanceof Error && /failed to fetch/i.test(error.message)) return 'Không thể kết nối tới Supabase Edge Function. Vui lòng kiểm tra cấu hình CORS và trạng thái deploy.';
  return (code && messages[code]) || (error instanceof Error ? error.message : 'Không thể hoàn thành thao tác.');
}
