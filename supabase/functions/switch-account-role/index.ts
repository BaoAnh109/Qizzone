import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  respond,
} from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const body = (await bodyJson(req, 4096)) as { role?: unknown };
    const targetRole = body.role;
    if (targetRole !== 'student' && targetRole !== 'teacher') {
      throw new Error('ROLE_SWITCH_INVALID');
    }

    const db = databaseAdmin();
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('*')
      .eq('firebase_uid', auth.uid)
      .maybeSingle();
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

    const nextAppMeta = { ...(auth.user.app_metadata || {}) } as Record<string, unknown>;
    nextAppMeta.role = 'authenticated';
    nextAppMeta.app_role = targetRole;
    nextAppMeta.account_status = 'approved';
    delete nextAppMeta.requested_role;

    await db.auth.admin.updateUserById(auth.uid, { app_metadata: nextAppMeta });
    const now = new Date().toISOString();
    await db.from('user_roles').upsert(
      {
        user_uid: auth.uid,
        base_role: profile.role,
        active_role: targetRole,
        updated_at: now,
      },
      { onConflict: 'user_uid' },
    );
    await db.from('role_audit_logs').insert({
      actor_uid: auth.uid,
      target_uid: auth.uid,
      action: 'switch_role',
      previous_role: auth.app_role || profile.role,
      new_role: targetRole,
    });

    return respond(req, { profile, active_role: targetRole }, 200, requestId);
  } catch (error) {
    return failure(req, error, requestId);
  }
});
