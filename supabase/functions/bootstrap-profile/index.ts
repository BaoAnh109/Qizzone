import { bodyJson, cors, databaseAdmin, failure, firebaseAdmin, identity, respond } from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  try {
    const token = await identity(req);
    const body = await bodyJson(req, 4096);
    const admin = firebaseAdmin();
    const user = await admin.getUser(token.uid);
    const db = databaseAdmin();
    const { data: existing, error: readError } = await db.from('profiles').select('*').eq('firebase_uid', user.uid).maybeSingle();
    if (readError) throw readError;
    if (!user.email) throw new Error('INVALID_INPUT');
    const requestedRole = body.requestedRole === 'teacher' ? 'teacher' : 'student';
    const role = existing?.role || requestedRole;
    const approvalStatus = existing?.approval_status || (requestedRole === 'teacher' ? 'pending' : 'approved');
    const requestedName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : '';
    const name = (body.overwriteName === true && requestedName) || existing?.full_name || requestedName || user.displayName || user.email?.split('@')[0] || 'Người dùng';
    const now = new Date().toISOString();
    const { data, error } = await db.from('profiles').upsert({
      firebase_uid: user.uid, email: user.email, full_name: name,
      role, approval_status: approvalStatus,
      approval_requested_at: existing?.approval_requested_at || (role === 'teacher' ? now : null),
      avatar_url: existing?.avatar_url || user.photoURL || null, updated_at: now,
    }).select().single();
    if (error) throw error;

    const nextClaims = { ...(user.customClaims || {}) };
    if (approvalStatus === 'approved') {
      nextClaims.role = 'authenticated';
      nextClaims.app_role = role;
      nextClaims.account_status = 'approved';
      delete nextClaims.requested_role;
    } else {
      delete nextClaims.role;
      delete nextClaims.app_role;
      nextClaims.account_status = approvalStatus;
      nextClaims.requested_role = role;
    }
    await admin.setCustomUserClaims(user.uid, nextClaims);
    return respond(req, data);
  } catch (error) { return failure(req, error); }
});
