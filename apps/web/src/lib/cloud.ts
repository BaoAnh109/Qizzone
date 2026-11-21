import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const missingConfiguration = Object.entries({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
})
  .filter(([, value]) => !value || /YOUR_|your_|placeholder/.test(value))
  .map(([key]) => key);

if (typeof document !== 'undefined' && missingConfiguration.length === 0) {
  try {
    const supabaseOrigin = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
    if (!document.querySelector(`link[rel="preconnect"][href="${supabaseOrigin}"]`)) {
      const dnsPrefetch = document.createElement('link');
      dnsPrefetch.rel = 'dns-prefetch';
      dnsPrefetch.href = supabaseOrigin;
      document.head.appendChild(dnsPrefetch);

      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = supabaseOrigin;
      preconnect.crossOrigin = '';
      document.head.appendChild(preconnect);
    }
  } catch {
    // Ignore malformed URL in non-production environments.
  }
}

let client: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  if (missingConfiguration.length) {
    throw new Error(`Thiếu cấu hình: ${missingConfiguration.join(', ')}. Xem hướng dẫn trong docs/RUNBOOK.md.`);
  }
  client ??= createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    },
  );
  return client;
}

export function supabaseAuth() {
  return supabase().auth;
}

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const db = supabase() as unknown as {
    rpc: (functionName: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Vui lòng đăng nhập.');
  return token;
}

export async function edge<T>(name: string, body: unknown, timeoutMs = 65_000): Promise<T> {
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
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

export async function edgeGet<T>(nameWithQuery: string, timeoutMs = 30_000): Promise<T> {
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nameWithQuery}`, {
      method: 'GET',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw error;
    throw new Error('Không thể kết nối tới Supabase Edge Function.', { cause: error });
  }
  if (response.status === 404) throw new Error('Supabase Edge Function chưa được deploy.');
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as { error?: string }).error || 'Không thể kết nối dịch vụ.');
  return result as T;
}

export function errorMessage(error: unknown): string {
  const errObj = error as { code?: string; message?: string } | undefined;
  const code = errObj?.code;
  const rawMessage = errObj?.message || '';
  const messages: Record<string, string> = {
    invalid_credentials: 'Email hoặc mật khẩu không đúng.',
    email_not_confirmed: 'Email chưa được xác minh. Vui lòng nhập mã OTP được gửi tới hộp thư.',
    user_already_exists: 'Email đã được đăng ký. Vui lòng đăng nhập.',
    email_exists: 'Email đã được đăng ký. Vui lòng đăng nhập.',
    over_email_send_rate_limit: 'Gửi email quá nhanh. Vui lòng chờ một lát rồi thử lại.',
    over_request_rate_limit: 'Quá nhiều lần thử. Vui lòng thử lại sau.',
    otp_expired: 'Mã OTP đã hết hạn hoặc không hợp lệ. Vui lòng yêu cầu mã mới.',
    otp_disabled: 'Xác thực OTP chưa được bật trên hệ thống.',
    weak_password: 'Mật khẩu chưa đủ mạnh (tối thiểu 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt).',
    same_password: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/email-already-in-use': 'Email đã được đăng ký. Vui lòng đăng nhập.',
    'auth/network-request-failed': 'Mất kết nối mạng. Vui lòng thử lại.',
    'auth/too-many-requests': 'Quá nhiều lần thử. Vui lòng thử lại sau.',
    'auth/weak-password': 'Mật khẩu phải có ít nhất 6 ký tự.',
    'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập Google.',
    'auth/operation-not-allowed': 'Phương thức đăng nhập này chưa được bật trên Supabase.',
  };
  if (code && messages[code]) return messages[code];
  if (/Invalid login credentials/i.test(rawMessage)) return messages.invalid_credentials;
  if (/Email not confirmed/i.test(rawMessage)) return messages.email_not_confirmed;
  if (/User already registered/i.test(rawMessage)) return messages.user_already_exists;
  if (/Token has expired or is invalid/i.test(rawMessage)) return messages.otp_expired;
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'Yêu cầu quá thời gian chờ. Vui lòng thử lại.';
  return error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.';
}
