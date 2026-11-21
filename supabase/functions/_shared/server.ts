import { createClient, type User as SupabaseAuthUser } from 'npm:@supabase/supabase-js@2';

export interface VerifiedIdentity {
  uid: string;
  email: string;
  app_role?: string;
  user: SupabaseAuthUser;
}

export interface ProfileDbRow {
  id?: string;
  firebase_uid: string;
  email: string;
  full_name: string;
  role: 'student' | 'teacher' | 'admin';
  approval_status: 'approved' | 'pending' | 'rejected';
  approval_requested_at?: string | null;
  teacher_request_status?: 'none' | 'pending' | 'approved' | 'rejected' | null;
  teacher_request_blocked?: boolean | null;
  teacher_requested_at?: string | null;
  teacher_reviewed_at?: string | null;
  teacher_reviewed_by?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  avatar_url?: string | null;
  created_at: string;
  updated_at?: string;
}

type AdminClient = ReturnType<typeof createClient>;

let cachedAdminClient: AdminClient | undefined;
let cachedRemoteJwks: { keys: JsonWebKey[]; fetchedAt: number } | undefined;
const importedJwksCache = new Map<string, CryptoKey>();
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

export function databaseAdmin(): AdminClient {
  if (cachedAdminClient) return cachedAdminClient;
  const keys = (() => {
    try {
      return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    } catch {
      return {};
    }
  })();
  const secretKey = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!secretKey || !url) throw new Error('NOT_CONFIGURED');
  cachedAdminClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdminClient;
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwksList(raw: unknown): Array<JsonWebKey & { kid?: string; alg?: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Array<JsonWebKey & { kid?: string; alg?: string }>;
  if (typeof raw === 'object' && Array.isArray((raw as { keys?: unknown }).keys)) {
    return (raw as { keys: Array<JsonWebKey & { kid?: string; alg?: string }> }).keys;
  }
  return [];
}

function getEnvJwks(): Array<JsonWebKey & { kid?: string; alg?: string }> {
  const raw = Deno.env.get('SUPABASE_JWKS');
  if (!raw) return [];
  try {
    return parseJwksList(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function getRemoteJwks(baseUrl: string, forceRefresh = false): Promise<Array<JsonWebKey & { kid?: string; alg?: string }>> {
  const now = Date.now();
  if (!forceRefresh && cachedRemoteJwks && now - cachedRemoteJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedRemoteJwks.keys as Array<JsonWebKey & { kid?: string; alg?: string }>;
  }
  try {
    const res = await fetch(`${baseUrl}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return cachedRemoteJwks ? (cachedRemoteJwks.keys as Array<JsonWebKey & { kid?: string; alg?: string }>) : [];
    const json = await res.json();
    const keys = parseJwksList(json);
    if (keys.length > 0) {
      cachedRemoteJwks = { keys, fetchedAt: now };
    }
    return keys;
  } catch {
    return cachedRemoteJwks ? (cachedRemoteJwks.keys as Array<JsonWebKey & { kid?: string; alg?: string }>) : [];
  }
}

async function resolveVerificationKey(
  alg: 'ES256' | 'RS256',
  kid: string | undefined,
  baseUrl: string,
): Promise<CryptoKey | null> {
  const cacheKey = `${alg}:${kid || 'default'}`;
  const cached = importedJwksCache.get(cacheKey);
  if (cached) return cached;

  const expectedKty = alg === 'ES256' ? 'EC' : 'RSA';
  const matchJwk = (list: Array<JsonWebKey & { kid?: string; alg?: string }>) => {
    if (kid) {
      return list.find(item => item.kid === kid && item.kty === expectedKty && (!item.alg || item.alg === alg));
    }
    return list.find(item => item.kty === expectedKty && (!item.alg || item.alg === alg));
  };

  let jwk = matchJwk(getEnvJwks());
  if (!jwk) {
    const remote = await getRemoteJwks(baseUrl, false);
    jwk = matchJwk(remote);
    if (!jwk && cachedRemoteJwks && Date.now() - cachedRemoteJwks.fetchedAt > 30_000) {
      jwk = matchJwk(await getRemoteJwks(baseUrl, true));
    }
  }
  if (!jwk) return null;

  const importAlg: EcKeyImportParams | RsaHashedImportParams =
    alg === 'ES256'
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, importAlg, false, ['verify']);
  importedJwksCache.set(`${alg}:${kid || jwk.kid || 'default'}`, cryptoKey);
  return cryptoKey;
}

async function verifyJwtLocally(token: string): Promise<VerifiedIdentity | null> {
  const url = Deno.env.get('SUPABASE_URL')?.replace(/\/+$/, '');
  if (!url) return null;

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('UNAUTHORIZED');
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  let sigBytes: Uint8Array;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadB64)));
    sigBytes = decodeBase64Url(sigB64);
  } catch {
    throw new Error('UNAUTHORIZED');
  }

  if (header.alg !== 'ES256' && header.alg !== 'RS256') {
    return null;
  }

  const cryptoKey = await resolveVerificationKey(header.alg, header.kid, url);
  if (!cryptoKey) return null;

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const verifyParams: EcdsaParams | AlgorithmIdentifier =
    header.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5';
  const signatureValid = await crypto.subtle.verify(verifyParams, cryptoKey, sigBytes, signingInput);
  if (!signatureValid) {
    throw new Error('UNAUTHORIZED');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('UNAUTHORIZED');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 30) {
    throw new Error('UNAUTHORIZED');
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!iss.startsWith(`${url}/auth/v1`)) {
    throw new Error('UNAUTHORIZED');
  }

  const aud = payload.aud;
  const validAud = aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated'));
  if (!validAud) {
    throw new Error('UNAUTHORIZED');
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!sub || !email) {
    throw new Error('UNAUTHORIZED');
  }

  const appMeta =
    payload.app_metadata && typeof payload.app_metadata === 'object'
      ? (payload.app_metadata as Record<string, unknown>)
      : {};
  const userMeta =
    payload.user_metadata && typeof payload.user_metadata === 'object'
      ? (payload.user_metadata as Record<string, unknown>)
      : {};
  const appRole = typeof appMeta.app_role === 'string' ? appMeta.app_role : undefined;

  return {
    uid: sub,
    email,
    app_role: appRole,
    user: {
      id: sub,
      email,
      app_metadata: appMeta,
      user_metadata: userMeta,
      role: typeof payload.role === 'string' ? payload.role : 'authenticated',
      aud: 'authenticated',
    } as unknown as SupabaseAuthUser,
  };
}

export async function identity(
  req: Request,
  options?: { requireRemoteUser?: boolean },
): Promise<VerifiedIdentity> {
  const match = req.headers.get('Authorization')?.match(/^Bearer (.+)$/);
  if (!match) throw new Error('UNAUTHORIZED');
  const token = match[1];

  if (!options?.requireRemoteUser) {
    const localIdentity = await verifyJwtLocally(token);
    if (localIdentity) return localIdentity;
  }

  const db = databaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user || !data.user.email) {
    throw new Error('UNAUTHORIZED');
  }
  const appRole = typeof data.user.app_metadata?.app_role === 'string'
    ? data.user.app_metadata.app_role
    : undefined;
  return {
    uid: data.user.id,
    email: data.user.email,
    app_role: appRole,
    user: data.user,
  };
}

export async function requireProfileAndRole(
  db: ReturnType<typeof databaseAdmin>,
  auth: VerifiedIdentity,
  allowedRoles: Array<'student' | 'teacher' | 'admin'>,
): Promise<{ profile: ProfileDbRow; activeRole: 'student' | 'teacher' | 'admin' }> {
  const { data: profile, error } = await db
    .from('profiles')
    .select('*')
    .eq('firebase_uid', auth.uid)
    .maybeSingle<ProfileDbRow>();

  if (error || !profile || profile.approval_status !== 'approved') {
    throw new Error('FORBIDDEN');
  }

  let effectiveRole: 'student' | 'teacher' | 'admin' = profile.role;
  if (profile.role === 'student' && auth.app_role === 'teacher' && profile.teacher_request_status === 'approved') {
    effectiveRole = 'teacher';
  }

  if (auth.app_role && auth.app_role !== effectiveRole) {
    throw new Error('FORBIDDEN');
  }

  if (!allowedRoles.includes(effectiveRole)) {
    throw new Error('FORBIDDEN');
  }

  return { profile, activeRole: effectiveRole };
}

export function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = new Set([
    ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  return {
    'Access-Control-Allow-Origin': allowed.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-correlation-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}

export function respond(req: Request, body: unknown, status = 200, requestId?: string) {
  const headers: Record<string, string> = cors(req);
  if (requestId) headers['X-Correlation-Id'] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

export async function bodyJson(req: Request, limit: number) {
  if (!req.headers.get('content-type')?.includes('application/json')) throw new Error('INVALID_INPUT');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('INVALID_INPUT');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('INVALID_INPUT');
  }
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  return `${head}***@${domain}`;
}

export function structuredLog(
  level: 'info' | 'warn' | 'error',
  event: Record<string, unknown>,
) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    if (/key|token|secret|password|url|prompt|content/i.test(k)) continue;
    safe[k] = typeof v === 'string' && v.includes('@') ? maskEmail(v) : v;
  }
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...safe });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function failure(req: Request, error: unknown, requestId?: string) {
  const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
  const messages: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.'],
    FORBIDDEN: [403, 'Bạn không có quyền sử dụng chức năng này.'],
    NOT_FOUND: [404, 'Không tìm thấy tài nguyên được yêu cầu.'],
    INVALID_INPUT: [400, 'Dữ liệu yêu cầu không hợp lệ.'],
    TOO_LARGE: [413, 'Kích thước dữ liệu vượt quá giới hạn cho phép.'],
    RATE_LIMIT: [429, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'],
    NOT_CONFIGURED: [503, 'Quản trị viên chưa cấu hình đầy đủ dịch vụ trên server.'],
    R2_NOT_CONFIGURED: [503, 'Dịch vụ lưu trữ Cloudflare R2 chưa được cấu hình trên server.'],
    R2_UPLOAD_NOT_FOUND: [404, 'Chưa tìm thấy tệp trên kho lưu trữ R2.'],
    R2_SIZE_MISMATCH: [400, 'Kích thước hoặc định dạng tệp trên R2 không khớp đăng ký.'],
    BREVO_NOT_CONFIGURED: [503, 'Dịch vụ gửi email Brevo chưa được cấu hình.'],
    RESEND_NOT_CONFIGURED: [503, 'Dịch vụ gửi email chưa được cấu hình.'],
    GEMINI_AUTH: [502, 'Gemini API key không hợp lệ hoặc chưa được cấp quyền sử dụng API.'],
    GEMINI_MODEL_UNAVAILABLE: [502, 'Mô hình Gemini đã cấu hình không khả dụng cho project này.'],
    GEMINI_BAD_REQUEST: [502, 'Gemini từ chối nội dung yêu cầu. Vui lòng thử với đề nhỏ hơn.'],
    GEMINI_TIMEOUT: [504, 'Mô hình Gemini phản hồi quá lâu. Vui lòng thử lại sau ít phút.'],
    GEMINI_UNAVAILABLE: [503, 'Hệ thống Gemini đang quá tải tạm thời. Vui lòng thử lại sau ít phút.'],
    GEMINI_EMPTY_RESPONSE: [502, 'Gemini không trả về nội dung hợp lệ. Vui lòng thử lại.'],
    GEMINI_INVALID_RESPONSE: [502, 'Gemini trả về dữ liệu không hợp lệ. Vui lòng thử lại.'],
    UPSTREAM_ERROR: [502, 'Không thể kết nối tới dịch vụ upstream. Vui lòng thử lại sau.'],
    TEACHER_REQUEST_BLOCKED: [403, 'Bạn không thể đổi tài khoản giáo viên ở tài khoản này. Vui lòng liên hệ hỗ trợ!'],
    TEACHER_REQUEST_PENDING: [409, 'Yêu cầu cấp tài khoản giáo viên của bạn đang chờ quản trị viên duyệt.'],
    TEACHER_ACCESS_NOT_APPROVED: [403, 'Tài khoản của bạn chưa được duyệt quyền giáo viên.'],
    ROLE_SWITCH_INVALID: [400, 'Vai trò chuyển đổi không hợp lệ.'],
    AVATAR_INVALID: [400, 'Ảnh không hợp lệ. Hãy chọn tệp JPG, PNG hoặc WebP.'],
    AVATAR_TOO_LARGE: [413, 'Ảnh đại diện phải nhỏ hơn 2 MB.'],
    PROFILE_NOT_FOUND: [404, 'Không tìm thấy hồ sơ tài khoản.'],
    GOOGLE_ONLY_ACCOUNT: [400, 'Tài khoản này được liên kết với Google và không có mật khẩu trên Qizzone.'],
    INVALID_CURRENT_PASSWORD: [400, 'Mật khẩu hiện tại không đúng.'],
    WEAK_PASSWORD: [400, 'Mật khẩu mới phải có ít nhất 8 ký tự, gồm chữ hoa, chữ số và ký tự đặc biệt.'],
    PASSWORD_UNCHANGED: [400, 'Mật khẩu mới phải khác mật khẩu hiện tại.'],
    PASSWORD_MISMATCH: [400, 'Xác nhận mật khẩu mới không khớp.'],
    OTP_INVALID: [400, 'Mã OTP không đúng hoặc chưa được yêu cầu.'],
    OTP_EXPIRED: [400, 'Mã OTP đã hết hạn (quá 15 phút). Vui lòng gửi mã mới.'],
    OTP_TOO_MANY_ATTEMPTS: [429, 'Bạn đã nhập sai mã OTP quá nhiều lần. Vui lòng yêu cầu mã mới.'],
  };
  const [status, message] = messages[code] || [502, 'Dịch vụ đang gặp lỗi. Vui lòng thử lại hoặc liên hệ quản trị viên.'];
  return respond(req, { error: message, code, requestId }, status, requestId);
}
