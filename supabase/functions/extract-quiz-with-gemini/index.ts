import { handleExtractQuizRequest } from '../_shared/extractHandler.ts';
import { cors, databaseAdmin, failure, identity, requireProfileAndRole, respond } from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    await requireProfileAndRole(db, auth, ['teacher', 'admin']);
    return await handleExtractQuizRequest(req, auth);
  } catch (error) {
    return failure(req, error);
  }
});
