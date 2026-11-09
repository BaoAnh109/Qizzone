import { bodyJson, cors, databaseAdmin, failure, firebaseAdmin, identity, respond } from '../_shared/server.ts';

const REQUEST_COLUMNS = 'firebase_uid,email,full_name,role,approval_status,approval_requested_at,teacher_request_status,teacher_request_blocked,teacher_requested_at,created_at';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);

  try {
    const token = await identity(req);
    const admin = firebaseAdmin();
    const actor = await admin.getUser(token.uid);
    const db = databaseAdmin();
    const { data: actorProfile, error: actorError } = await db
      .from('profiles')
      .select('firebase_uid,role,approval_status')
      .eq('firebase_uid', token.uid)
      .maybeSingle();
    if (
      actorError ||
      !actorProfile ||
      actorProfile.role !== 'admin' ||
      actorProfile.approval_status !== 'approved' ||
      token.app_role !== 'admin' ||
      actor.customClaims?.app_role !== 'admin'
    ) throw new Error('FORBIDDEN');

    const body = await bodyJson(req, 4096);
    if (body.action === 'list') {
      const [studentResult, blockedStudentResult, legacyResult] = await Promise.all([
        db.from('profiles')
          .select(REQUEST_COLUMNS)
          .eq('role', 'student')
          .eq('teacher_request_status', 'pending'),
        db.from('profiles')
          .select(REQUEST_COLUMNS)
          .eq('role', 'student')
          .eq('teacher_request_blocked', true),
        db.from('profiles')
          .select(REQUEST_COLUMNS)
          .eq('role', 'teacher')
          .eq('approval_status', 'pending'),
      ]);
      if (studentResult.error) throw studentResult.error;
      if (blockedStudentResult.error) throw blockedStudentResult.error;
      if (legacyResult.error) throw legacyResult.error;
      type RequestRow = {
        firebase_uid: string;
        teacher_requested_at: string | null;
        approval_requested_at: string | null;
        created_at: string;
        [key: string]: unknown;
      };
      const rows = new Map<string, RequestRow>();
      for (const row of [...(studentResult.data || []), ...(blockedStudentResult.data || []), ...(legacyResult.data || [])]) rows.set(row.firebase_uid, row);
      const requests = [...rows.values()].sort((left, right) => {
        const leftDate = left.teacher_requested_at || left.approval_requested_at || left.created_at;
        const rightDate = right.teacher_requested_at || right.approval_requested_at || right.created_at;
        return new Date(leftDate).getTime() - new Date(rightDate).getTime();
      });
      return respond(req, { requests });
    }

    if (typeof body.firebaseUid !== 'string' || !body.firebaseUid) throw new Error('INVALID_INPUT');

    if (body.action === 'set_blocked') {
      if (typeof body.blocked !== 'boolean') throw new Error('INVALID_INPUT');
      const { data: target, error: targetError } = await db
        .from('profiles')
        .select('firebase_uid,role')
        .eq('firebase_uid', body.firebaseUid)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.role !== 'student') throw new Error('INVALID_INPUT');
      const { data, error } = await db.from('profiles').update({
        teacher_request_blocked: body.blocked,
        updated_at: new Date().toISOString(),
      }).eq('firebase_uid', target.firebase_uid).select().single();
      if (error) throw error;
      console.info(JSON.stringify({ action: 'set_teacher_request_blocked', adminUid: token.uid, targetUid: target.firebase_uid, blocked: body.blocked }));
      return respond(req, { profile: data });
    }

    if (!['approve', 'reject'].includes(body.action)) throw new Error('INVALID_INPUT');
    const { data: target, error: targetError } = await db
      .from('profiles')
      .select('*')
      .eq('firebase_uid', body.firebaseUid)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) throw new Error('INVALID_INPUT');

    const isStudentRequest = target.role === 'student' && target.teacher_request_status === 'pending';
    const isLegacyTeacherRequest = target.role === 'teacher' && target.approval_status === 'pending';
    if (!isStudentRequest && !isLegacyTeacherRequest) throw new Error('INVALID_INPUT');

    const targetUser = await admin.getUser(target.firebase_uid);
    const nextClaims = { ...(targetUser.customClaims || {}) };
    const now = new Date().toISOString();

    if (isStudentRequest) {
      const nextStatus = body.action === 'approve' ? 'approved' : 'rejected';
      const { data, error } = await db.from('profiles').update({
        teacher_request_status: nextStatus,
        teacher_reviewed_at: now,
        teacher_reviewed_by: token.uid,
        updated_at: now,
      }).eq('firebase_uid', target.firebase_uid).select().single();
      if (error) throw error;

      // A student remains a student after either decision. Approval grants the
      // ability to switch; it does not silently move the active session.
      nextClaims.role = 'authenticated';
      nextClaims.app_role = 'student';
      nextClaims.account_status = 'approved';
      delete nextClaims.requested_role;
      await admin.setCustomUserClaims(target.firebase_uid, nextClaims);
      console.info(JSON.stringify({ action: `${body.action}_teacher_access`, adminUid: token.uid, targetUid: target.firebase_uid }));
      return respond(req, { profile: data });
    }

    if (body.action === 'approve') {
      const { data, error } = await db.from('profiles').update({
        approval_status: 'approved',
        teacher_request_status: 'approved',
        reviewed_at: now,
        reviewed_by: token.uid,
        teacher_reviewed_at: now,
        teacher_reviewed_by: token.uid,
        updated_at: now,
      }).eq('firebase_uid', target.firebase_uid).select().single();
      if (error) throw error;
      nextClaims.role = 'authenticated';
      nextClaims.app_role = 'teacher';
      nextClaims.account_status = 'approved';
      delete nextClaims.requested_role;
      await admin.setCustomUserClaims(target.firebase_uid, nextClaims);
      await admin.revokeRefreshTokens(target.firebase_uid);
      console.info(JSON.stringify({ action: 'approve_teacher', adminUid: token.uid, targetUid: target.firebase_uid }));
      return respond(req, { profile: data });
    }

    delete nextClaims.role;
    delete nextClaims.app_role;
    nextClaims.account_status = 'rejected';
    nextClaims.requested_role = 'teacher';
    await admin.setCustomUserClaims(target.firebase_uid, nextClaims);
    await admin.revokeRefreshTokens(target.firebase_uid);
    const { data, error } = await db.from('profiles').update({
      approval_status: 'rejected',
      teacher_request_status: 'rejected',
      reviewed_at: now,
      reviewed_by: token.uid,
      teacher_reviewed_at: now,
      teacher_reviewed_by: token.uid,
      updated_at: now,
    }).eq('firebase_uid', target.firebase_uid).select().single();
    if (error) throw error;
    console.info(JSON.stringify({ action: 'reject_teacher', adminUid: token.uid, targetUid: target.firebase_uid }));
    return respond(req, { profile: data });
  } catch (error) {
    return failure(req, error);
  }
});
