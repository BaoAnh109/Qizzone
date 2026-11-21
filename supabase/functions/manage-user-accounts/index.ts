import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
} from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    await requireProfileAndRole(db, auth, ['admin']);

    const body = (await bodyJson(req, 4096)) as {
      action?: unknown;
      role?: unknown;
      userId?: unknown;
      isBlocked?: unknown;
    };

    if (body.action === 'list') {
      let query = db
        .from('profiles')
        .select('id, firebase_uid, email, full_name, role, approval_status, created_at')
        .in('role', ['teacher', 'student'])
        .order('created_at', { ascending: false });

      if (body.role === 'teacher' || body.role === 'student') {
        query = query.eq('role', body.role);
      }

      const { data: accounts, error } = await query;
      if (error) throw error;

      const enriched = (accounts || []).map(row => ({
        ...row,
        is_blocked: row.approval_status === 'rejected',
      }));
      return respond(req, { accounts: enriched }, 200, requestId);
    }

    if (body.action === 'toggle_block') {
      if (typeof body.userId !== 'string' || !body.userId || typeof body.isBlocked !== 'boolean') {
        throw new Error('INVALID_INPUT');
      }
      if (body.userId === auth.uid) throw new Error('FORBIDDEN');

      const { data: target, error: targetError } = await db
        .from('profiles')
        .select('firebase_uid, role')
        .eq('firebase_uid', body.userId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.role === 'admin') throw new Error('FORBIDDEN');

      const now = new Date().toISOString();
      const nextStatus = body.isBlocked ? 'rejected' : 'approved';
      const [updateResult, authUserResult] = await Promise.all([
        db
          .from('profiles')
          .update({
            approval_status: nextStatus,
            reviewed_at: now,
            reviewed_by: auth.uid,
            updated_at: now,
          })
          .eq('firebase_uid', target.firebase_uid)
          .select()
          .single(),
        db.auth.admin.getUserById(target.firebase_uid),
      ]);
      const { data: updated, error: updateError } = updateResult;
      if (updateError) throw updateError;

      const { data: targetAuthUser } = authUserResult;
      const nextAppMeta = { ...((targetAuthUser?.user?.app_metadata || {}) as Record<string, unknown>) };
      if (body.isBlocked) {
        delete nextAppMeta.role;
        delete nextAppMeta.app_role;
        nextAppMeta.account_status = 'rejected';
      } else {
        nextAppMeta.role = 'authenticated';
        nextAppMeta.app_role = target.role;
        nextAppMeta.account_status = 'approved';
      }

      await Promise.all([
        db.auth.admin.updateUserById(target.firebase_uid, { app_metadata: nextAppMeta }),
        db.from('role_audit_logs').insert({
          actor_uid: auth.uid,
          target_uid: target.firebase_uid,
          action: body.isBlocked ? 'block_account' : 'unblock_account',
        }),
      ]);

      return respond(req, { profile: updated }, 200, requestId);
    }

    throw new Error('INVALID_INPUT');
  } catch (error) {
    return failure(req, error, requestId);
  }
});
