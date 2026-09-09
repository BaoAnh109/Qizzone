import { initializeApp, cert, getApps } from 'npm:firebase-admin@13/app';
import { getAuth } from 'npm:firebase-admin@13/auth';
import { createClient } from 'npm:@supabase/supabase-js@2';

export function firebaseAdmin() {
  if (!getApps().length) {
    try {
      const account = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '{}');
      if (!account.project_id || !account.client_email || !account.private_key) throw new Error('missing fields');
      initializeApp({ credential: cert(account), projectId: account.project_id });
    } catch {
      throw new Error('NOT_CONFIGURED');
    }
  }
  return getAuth();
}
export function databaseAdmin() {
  const keys = (() => { try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { return {}; } })();
  const secretKey = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secretKey) throw new Error('NOT_CONFIGURED');
  return createClient(Deno.env.get('SUPABASE_URL')!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function identity(req: Request) {
  const match = req.headers.get('Authorization')?.match(/^Bearer (.+)$/);
  if (!match) throw new Error('UNAUTHORIZED');
  const admin = firebaseAdmin();
  try {
    // Checks signature, issuer, audience, expiry, revocation and disabled users.
    return await admin.verifyIdToken(match[1], true);
  } catch { throw new Error('UNAUTHORIZED'); }
}
export function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  };
}
export function respond(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}
export async function bodyJson(req: Request, limit: number) {
  if (!req.headers.get('content-type')?.includes('application/json')) throw new Error('INVALID_INPUT');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('INVALID_INPUT');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('INVALID_INPUT'); }
}
export function failure(req: Request, error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.'],
    FORBIDDEN: [403, 'Bạn không có quyền sử dụng chức năng này.'],
    INVALID_INPUT: [400, 'Dữ liệu yêu cầu không hợp lệ.'],
    TOO_LARGE: [413, 'Tệp hoặc văn bản quá lớn (tối đa 8 MB).'],
    RATE_LIMIT: [429, 'Quá nhiều yêu cầu AI. Vui lòng chờ một phút.'],
    NOT_CONFIGURED: [503, 'Quản trị viên chưa cấu hình Gemini trên server.'],
    GEMINI_AUTH: [502, 'Gemini API key không hợp lệ hoặc chưa được cấp quyền sử dụng API.'],
    GEMINI_MODEL_UNAVAILABLE: [502, 'Mô hình Gemini đã cấu hình không khả dụng cho project này.'],
    GEMINI_BAD_REQUEST: [502, 'Gemini từ chối nội dung yêu cầu. Vui lòng thử với đề nhỏ hơn.'],
  };
  const [status, message] = messages[code] || [502, 'Dịch vụ đang gặp lỗi. Vui lòng thử lại hoặc liên hệ quản trị viên.'];
  return respond(req, { error: message }, status);
}
