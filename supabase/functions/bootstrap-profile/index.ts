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
    let auth = await identity(req);
    const body = (await bodyJson(req, 4096)) as {
      fullName?: unknown;
      overwriteName?: unknown;
    };
    const db = databaseAdmin();
    let { data: existing, error: readError } = await db
      .from('profiles')
      .select('*')
      .eq('firebase_uid', auth.uid)
      .maybeSingle();
    if (readError) throw readError;

    const wasNewOrLegacy = !existing;
    if (!existing) {
      auth = await identity(req, { requireRemoteUser: true });
      if (auth.user.email_confirmed_at) {
        const { data: relinked, error: relinkErr } = await db.rpc('relink_legacy_profile_v3', {
          p_email: auth.email,
          p_new_uid: auth.uid,
        });
        if (relinkErr) throw relinkErr;
        if (relinked && relinked.firebase_uid === auth.uid) {
          existing = relinked;
        }
      } else {
        const { data: conflict, error: conflictError } = await db
          .from('profiles')
          .select('firebase_uid')
          .ilike('email', auth.email.replace(/[\\%_]/g, '\\$&'))
          .maybeSingle();
        if (conflictError) throw conflictError;
        if (conflict) {
          return respond(
            req,
            {
              error: 'Email này đã có tài khoản trước đó. Vui lòng xác nhận email/OTP hoặc đăng nhập Google để liên kết an toàn.',
              code: 'EMAIL_REQUIRES_VERIFICATION',
              requestId,
            },
            409,
            requestId,
          );
        }
      }
    }

    // Public bootstrap can never create or promote a teacher/admin profile.
    const role = existing?.role || 'student';
    const approvalStatus = existing?.approval_status || 'approved';
    const teacherRequestStatus =
      existing?.teacher_request_status || (role === 'teacher' ? approvalStatus : 'none');
    const teacherRequestBlocked = existing?.teacher_request_blocked === true;

    const requestedName =
      typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : '';
    const metaName =
      typeof auth.user.user_metadata?.full_name === 'string'
        ? auth.user.user_metadata.full_name.trim().slice(0, 100)
        : '';
    const metaAvatar =
      typeof auth.user.user_metadata?.avatar_url === 'string' && auth.user.user_metadata.avatar_url
        ? auth.user.user_metadata.avatar_url
        : typeof auth.user.user_metadata?.picture === 'string' && auth.user.user_metadata.picture
          ? auth.user.user_metadata.picture
          : null;

    const name =
      (body.overwriteName === true && requestedName) ||
      existing?.full_name ||
      requestedName ||
      metaName ||
      auth.email.split('@')[0] ||
      'Người dùng';
    const nextAvatar = existing?.avatar_url || metaAvatar || null;

    const now = new Date().toISOString();
    const needsProfileUpsert =
      !existing ||
      existing.id !== auth.uid ||
      existing.full_name !== name ||
      (existing.avatar_url ?? null) !== nextAvatar ||
      body.overwriteName === true;

    let data = existing;
    if (needsProfileUpsert) {
      const upsertResult = await db
        .from('profiles')
        .upsert(
          {
            id: auth.uid,
            firebase_uid: auth.uid,
            email: auth.email,
            full_name: name,
            role,
            approval_status: approvalStatus,
            approval_requested_at: existing?.approval_requested_at || (role === 'teacher' ? now : null),
            teacher_request_status: teacherRequestStatus,
            teacher_request_blocked: teacherRequestBlocked,
            teacher_requested_at:
              existing?.teacher_requested_at ||
              (role === 'teacher' ? existing?.approval_requested_at || now : null),
            teacher_reviewed_at:
              existing?.teacher_reviewed_at ||
              (role === 'teacher' && approvalStatus !== 'pending'
                ? existing?.reviewed_at || now
                : null),
            teacher_reviewed_by: existing?.teacher_reviewed_by || existing?.reviewed_by || null,
            avatar_url: nextAvatar,
            updated_at: now,
          },
          { onConflict: 'firebase_uid' },
        )
        .select()
        .single();
      if (upsertResult.error) throw upsertResult.error;
      data = upsertResult.data;
    }

    const currentAppMeta = (auth.user.app_metadata || {}) as Record<string, unknown>;
    const nextAppMeta = { ...currentAppMeta };
    if (approvalStatus === 'approved') {
      const claimedRole = currentAppMeta.app_role;
      const activeRole =
        role === 'admin'
          ? 'admin'
          : role === 'teacher'
            ? 'teacher'
            : teacherRequestStatus === 'approved' && claimedRole === 'teacher'
              ? 'teacher'
              : 'student';

      const needsAuthMetaUpdate =
        currentAppMeta.role !== 'authenticated' ||
        currentAppMeta.app_role !== activeRole ||
        currentAppMeta.account_status !== 'approved' ||
        'requested_role' in currentAppMeta;

      nextAppMeta.role = 'authenticated';
      nextAppMeta.app_role = activeRole;
      nextAppMeta.account_status = 'approved';
      delete nextAppMeta.requested_role;

      const ops: Promise<unknown>[] = [];
      if (needsAuthMetaUpdate) {
        ops.push(db.auth.admin.updateUserById(auth.uid, { app_metadata: nextAppMeta }));
      }
      if (wasNewOrLegacy || needsAuthMetaUpdate) {
        ops.push(
          db.from('user_roles').upsert(
            {
              user_uid: auth.uid,
              base_role: role,
              active_role: activeRole,
              updated_at: now,
            },
            { onConflict: 'user_uid' },
          ),
        );
      }
      if (ops.length > 0) {
        await Promise.all(ops);
      }

      return respond(req, { ...data, active_role: activeRole }, 200, requestId);
    }

    const needsBlockedMetaUpdate =
      'role' in currentAppMeta ||
      'app_role' in currentAppMeta ||
      currentAppMeta.account_status !== approvalStatus ||
      currentAppMeta.requested_role !== role;
    if (needsBlockedMetaUpdate) {
      delete nextAppMeta.role;
      delete nextAppMeta.app_role;
      nextAppMeta.account_status = approvalStatus;
      nextAppMeta.requested_role = role;
      await db.auth.admin.updateUserById(auth.uid, { app_metadata: nextAppMeta });
    }
    return respond(req, { ...data, active_role: null }, 200, requestId);
  } catch (error) {
    return failure(req, error, requestId);
  }
});
