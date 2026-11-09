import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { bodyJson, databaseAdmin, failure, identity, respond } from '../_shared/server.ts';

interface AvatarBody { dataUrl?: unknown }

function hasValidImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return respond(req, { ok: true });
  try {
    if (req.method !== 'POST') return respond(req, { error: 'Method not allowed.' }, 405);
    const body = await bodyJson(req, 3_500_000) as AvatarBody;
    const claims = await identity(req);
    if (!claims.sub) throw new Error('UNAUTHORIZED');
    if (typeof body.dataUrl !== 'string') throw new Error('AVATAR_INVALID');

    const match = body.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('AVATAR_INVALID');
    const mime = match[1];
    const encoded = match[2];
    if (encoded.length > 2_800_000) throw new Error('AVATAR_TOO_LARGE');
    const binary = atob(encoded);
    if (binary.length > 2 * 1024 * 1024) throw new Error('AVATAR_TOO_LARGE');
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (!hasValidImageSignature(bytes, mime)) throw new Error('AVATAR_INVALID');

    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
    const objectPath = `${claims.sub}/avatar.${extension}`;
    const db = databaseAdmin();
    const { error: uploadError } = await db.storage.from('account-avatars').upload(objectPath, bytes, {
      contentType: mime,
      cacheControl: '0',
      upsert: true,
    });
    if (uploadError) throw new Error('UPSTREAM_ERROR');

    const { data } = db.storage.from('account-avatars').getPublicUrl(objectPath);
    const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
    return respond(req, { avatarUrl });
  } catch (error) {
    return failure(req, error);
  }
});
