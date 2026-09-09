import { bodyJson, cors, databaseAdmin, failure, firebaseAdmin, identity, respond } from '../_shared/server.ts';

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
      const { data, error } = await db
        .from('profiles')
        .select('firebase_uid,email,full_name,role,approval_status,approval_requested_at,created_at')
        .eq('role', 'teacher')
        .eq('approval_status', 'pending')
        .order('approval_requested_at', { ascending: true });
      if (error) throw error;
      return respond(req, { requests: data || [] });
    }

    if (!['approve', 'reject'].includes(body.action) || typeof body.firebaseUid !== 'string' || !body.firebaseUid) {
      throw new Error('INVALID_INPUT');
    }
    const { data: target, error: targetError } = await db
      .from('profiles')
      .select('*')
      .eq('firebase_uid', body.firebaseUid)
      .eq('role', 'teacher')
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) throw new Error('INVALID_INPUT');

    const targetUser = await admin.getUser(target.firebase_uid);
    const nextClaims = { ...(targetUser.customClaims || {}) };
    const now = new Date().toISOString();

    if (body.action === 'approve') {
      const { data, error } = await db.from('profiles').update({
        approval_status: 'approved', reviewed_at: now, reviewed_by: token.uid, updated_at: now,
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
      approval_status: 'rejected', reviewed_at: now, reviewed_by: token.uid, updated_at: now,
    }).eq('firebase_uid', target.firebase_uid).select().single();
    if (error) throw error;
    console.info(JSON.stringify({ action: 'reject_teacher', adminUid: token.uid, targetUid: target.firebase_uid }));
    return respond(req, { profile: data });
  } catch (error) {
    return failure(req, error);
  }
});
