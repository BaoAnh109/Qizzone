import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
  structuredLog,
} from '../_shared/server.ts';

const OTP_TTL_SECONDS = 900;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

function parseSender(rawEmail: string | undefined, rawName: string | undefined): { name: string; email: string } {
  const fallbackName = rawName?.trim() || 'Qizzone';
  const trimmed = rawEmail?.trim() || 'no-reply@qizzone.edu.vn';
  const angleMatch = trimmed.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].replace(/^["']|["']$/g, '').trim() || fallbackName,
      email: angleMatch[2].trim(),
    };
  }
  return { name: fallbackName, email: trimmed };
}

function getPublicApiKey(): string {
  try {
    const pubKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}') as { default?: string };
    if (pubKeys.default) return pubKeys.default;
  } catch {
    // Fall back to SUPABASE_ANON_KEY below.
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  if (!anonKey) throw new Error('NOT_CONFIGURED');
  return anonKey;
}

function getOtpPepper(): string {
  try {
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as { default?: string };
    if (secretKeys.default) return secretKeys.default;
  } catch {
    // Fall back to SUPABASE_SERVICE_ROLE_KEY below.
  }
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!serviceKey) throw new Error('NOT_CONFIGURED');
  return serviceKey;
}

async function hashOtp(uid: string, otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getOtpPepper()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${uid}:${otp}`));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

function generateNumericOtp(digits = 6): string {
  const buf = new Uint32Array(1);
  const max = Math.pow(10, digits);
  const limit = Math.floor(0xffffffff / max) * max;
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return String(value % max).padStart(digits, '0');
}

async function verifyCurrentPassword(email: string, currentPassword: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  if (!url) throw new Error('NOT_CONFIGURED');
  const anonKey = getPublicApiKey();
  const authVerifier = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await authVerifier.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (error) {
    throw new Error('INVALID_CURRENT_PASSWORD');
  }
}

async function sendOtpEmailViaBrevo(toEmail: string, fullName: string, otp: string): Promise<void> {
  const brevoApiKey = Deno.env.get('BREVO_API_KEY')?.trim();
  if (!brevoApiKey) {
    throw new Error('BREVO_NOT_CONFIGURED');
  }
  const sender = parseSender(Deno.env.get('BREVO_FROM_EMAIL'), Deno.env.get('BREVO_FROM_NAME'));
  const safeName = fullName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const htmlContent = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#1d4ed8">Xác nhận đổi mật khẩu Qizzone</h2>
      <p>Xin chào <strong>${safeName || 'bạn'}</strong>,</p>
      <p>Hệ thống vừa nhận được yêu cầu đổi mật khẩu cho tài khoản Qizzone của bạn. Vui lòng nhập mã OTP sau để xác thực:</p>
      <div style="margin:20px 0;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;text-align:center;font-size:28px;font-weight:700;letter-spacing:6px;color:#1e3a8a">
        ${otp}
      </div>
      <p style="font-size:13px;color:#475569">Mã OTP có hiệu lực trong <strong>15 phút</strong>. Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email và giữ an toàn cho tài khoản.</p>
    </div>
  `.trim();

  const res = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'api-key': brevoApiKey,
    },
    body: JSON.stringify({
      sender,
      to: [{ email: toEmail }],
      subject: '[Qizzone] Mã OTP xác nhận đổi mật khẩu',
      htmlContent,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error('UPSTREAM_ERROR');
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    const { profile } = await requireProfileAndRole(db, auth, ['student', 'teacher', 'admin']);

    const { data: adminUserData, error: userErr } = await db.auth.admin.getUserById(auth.uid);
    if (userErr || !adminUserData?.user) {
      throw new Error('UNAUTHORIZED');
    }
    const authUser = adminUserData.user;

    const providers = new Set<string>();
    const appMetaProviders = authUser.app_metadata?.providers;
    if (Array.isArray(appMetaProviders)) {
      for (const p of appMetaProviders) {
        if (typeof p === 'string' && p) providers.add(p);
      }
    }
    if (typeof authUser.app_metadata?.provider === 'string' && authUser.app_metadata.provider) {
      providers.add(authUser.app_metadata.provider);
    }
    if (Array.isArray(authUser.identities)) {
      for (const ident of authUser.identities) {
        if (typeof ident.provider === 'string' && ident.provider) providers.add(ident.provider);
      }
    }
    if (providers.size > 0 && !providers.has('email')) {
      throw new Error('GOOGLE_ONLY_ACCOUNT');
    }

    const body = (await bodyJson(req, 4096)) as {
      action?: unknown;
      currentPassword?: unknown;
      newPassword?: unknown;
      confirmPassword?: unknown;
      otp?: unknown;
    };

    const action = body.action === 'request_otp' || body.action === 'confirm_change' ? body.action : null;
    if (!action) throw new Error('INVALID_INPUT');

    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
    if (!currentPassword || !newPassword || !confirmPassword) {
      throw new Error('INVALID_INPUT');
    }
    if (newPassword !== confirmPassword) {
      throw new Error('PASSWORD_MISMATCH');
    }
    if (newPassword === currentPassword) {
      throw new Error('PASSWORD_UNCHANGED');
    }
    if (
      newPassword.length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/\d/.test(newPassword) ||
      !/[\p{P}\p{S}]/u.test(newPassword)
    ) {
      throw new Error('WEAK_PASSWORD');
    }

    await verifyCurrentPassword(auth.email, currentPassword);

    if (action === 'request_otp') {
      const otp = generateNumericOtp(6);
      const otpHash = await hashOtp(auth.uid, otp);
      const { data: expiresAt, error: otpErr } = await db.rpc('create_password_change_otp_v3', {
        p_uid: auth.uid,
        p_otp_hash: otpHash,
        p_ttl_seconds: OTP_TTL_SECONDS,
        p_cooldown_seconds: OTP_COOLDOWN_SECONDS,
      });
      if (otpErr) {
        if (otpErr.message?.includes('RATE_LIMIT')) {
          throw new Error('RATE_LIMIT');
        }
        throw otpErr;
      }

      await sendOtpEmailViaBrevo(auth.email, profile.full_name, otp);

      structuredLog('info', {
        requestId,
        action: 'request_password_change_otp',
        uid: auth.uid,
        email: auth.email,
      });

      return respond(
        req,
        {
          sent: true,
          expiresAt,
          expiresInSeconds: OTP_TTL_SECONDS,
          cooldownSeconds: OTP_COOLDOWN_SECONDS,
        },
        200,
        requestId,
      );
    }

    const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
    if (!/^\d{6}$/.test(otp)) {
      throw new Error('OTP_INVALID');
    }

    const otpHash = await hashOtp(auth.uid, otp);
    const { data: verifyResult, error: verifyErr } = await db.rpc('verify_password_change_otp_v3', {
      p_uid: auth.uid,
      p_otp_hash: otpHash,
      p_max_attempts: OTP_MAX_ATTEMPTS,
    });
    if (verifyErr) throw verifyErr;

    if (verifyResult === 'expired') throw new Error('OTP_EXPIRED');
    if (verifyResult === 'too_many_attempts') throw new Error('OTP_TOO_MANY_ATTEMPTS');
    if (verifyResult !== 'ok') throw new Error('OTP_INVALID');

    const { error: updateErr } = await db.auth.admin.updateUserById(auth.uid, {
      password: newPassword,
    });
    if (updateErr) throw updateErr;

    await db.from('audit_logs').insert({
      actor_uid: auth.uid,
      action: 'change_password',
      resource_type: 'auth_user',
      resource_id: auth.uid,
    });

    structuredLog('info', {
      requestId,
      action: 'confirm_password_change',
      uid: auth.uid,
    });

    return respond(req, { updated: true }, 200, requestId);
  } catch (error) {
    return failure(req, error, requestId);
  }
});
