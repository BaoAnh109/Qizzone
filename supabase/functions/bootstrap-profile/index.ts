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

    // Public bootstrap can never create or promote a teacher profile. Teacher
    // access is requested separately and reviewed by an approved admin.
    const role = existing?.role || 'student';
    const approvalStatus = existing?.approval_status || 'approved';
    const teacherRequestStatus = existing?.teacher_request_status || (role === 'teacher' ? approvalStatus : 'none');
    const teacherRequestBlocked = existing?.teacher_request_blocked === true;
    const requestedName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : '';
    const name = (body.overwriteName === true && requestedName) || existing?.full_name || requestedName || user.displayName || user.email?.split('@')[0] || 'Người dùng';
    const now = new Date().toISOString();
    const { data, error } = await db.from('profiles').upsert({
      firebase_uid: user.uid,
      email: user.email,
      full_name: name,
      role,
      approval_status: approvalStatus,
      approval_requested_at: existing?.approval_requested_at || (role === 'teacher' ? now : null),
      teacher_request_status: teacherRequestStatus,
      teacher_request_blocked: teacherRequestBlocked,
      teacher_requested_at: existing?.teacher_requested_at || (role === 'teacher' ? existing?.approval_requested_at || now : null),
      teacher_reviewed_at: existing?.teacher_reviewed_at || (role === 'teacher' && approvalStatus !== 'pending' ? existing?.reviewed_at || now : null),
      teacher_reviewed_by: existing?.teacher_reviewed_by || existing?.reviewed_by || null,
      avatar_url: existing?.avatar_url || user.photoURL || null,
      updated_at: now,
    }).select().single();
    if (error) throw error;

    const nextClaims = { ...(user.customClaims || {}) };
    if (approvalStatus === 'approved') {
      const claimedRole = user.customClaims?.app_role;
      const activeRole = role === 'admin'
        ? 'admin'
        : role === 'teacher'
          ? 'teacher'
          : teacherRequestStatus === 'approved' && claimedRole === 'teacher'
            ? 'teacher'
            : 'student';
      nextClaims.role = 'authenticated';
      nextClaims.app_role = activeRole;
      nextClaims.account_status = 'approved';
      delete nextClaims.requested_role;
      await admin.setCustomUserClaims(user.uid, nextClaims);
      return respond(req, { ...data, active_role: activeRole });
    }

    delete nextClaims.role;
    delete nextClaims.app_role;
    nextClaims.account_status = approvalStatus;
    nextClaims.requested_role = role;
    await admin.setCustomUserClaims(user.uid, nextClaims);
    return respond(req, { ...data, active_role: null });
  } catch (error) {
    return failure(req, error);
  }
});
