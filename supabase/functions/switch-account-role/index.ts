import { bodyJson, cors, databaseAdmin, failure, firebaseAdmin, identity, respond } from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);

  try {
    const token = await identity(req);
    const body = await bodyJson(req, 4096);
    const targetRole = body.role;
    if (targetRole !== 'student' && targetRole !== 'teacher') throw new Error('ROLE_SWITCH_INVALID');

    const admin = firebaseAdmin();
    const user = await admin.getUser(token.uid);
    const db = databaseAdmin();
    const { data: profile, error: profileError } = await db.from('profiles').select('*').eq('firebase_uid', token.uid).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.approval_status !== 'approved') throw new Error('FORBIDDEN');

    if (profile.role === 'admin') throw new Error('FORBIDDEN');

    if (targetRole === 'teacher') {
      const legacyTeacher = profile.role === 'teacher' && profile.approval_status === 'approved';
      const approvedRequest = profile.role === 'student' && profile.teacher_request_status === 'approved';
      if (!legacyTeacher && !approvedRequest) {
        if (profile.teacher_request_blocked) throw new Error('TEACHER_REQUEST_BLOCKED');
        if (profile.teacher_request_status === 'pending') throw new Error('TEACHER_REQUEST_PENDING');
        throw new Error('TEACHER_ACCESS_NOT_APPROVED');
      }
    } else if (profile.role !== 'student') {
      throw new Error('ROLE_SWITCH_INVALID');
    }

    const nextClaims = { ...(user.customClaims || {}) };
    nextClaims.role = 'authenticated';
    nextClaims.app_role = targetRole;
    nextClaims.account_status = 'approved';
    delete nextClaims.requested_role;
    await admin.setCustomUserClaims(token.uid, nextClaims);
    return respond(req, { profile, active_role: targetRole });
  } catch (error) {
    return failure(req, error);
  }
});
