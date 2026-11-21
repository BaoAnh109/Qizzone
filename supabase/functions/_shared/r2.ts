const encoder = new TextEncoder();

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpointHost: string;
}

export function getR2Config(): R2Config {
  const accountId = Deno.env.get('R2_ACCOUNT_ID')?.trim();
  const bucket = Deno.env.get('R2_BUCKET_NAME')?.trim();
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')?.trim();
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')?.trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_NOT_CONFIGURED');
  }
  const endpointHost = (Deno.env.get('R2_S3_HOST')?.trim() || `${accountId}.r2.cloudflarestorage.com`)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return { accountId, bucket, accessKeyId, secretAccessKey, endpointHost };
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

async function signingKey(secretKey: string, dateStamp: string, region = 'auto', service = 's3'): Promise<Uint8Array> {
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function encodeRfc3986Path(path: string): string {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** Generates a short-lived SigV4 presigned PUT or GET URL for private Cloudflare R2. */
export async function presignR2ObjectUrl(params: {
  method: 'PUT' | 'GET' | 'HEAD';
  objectKey: string;
  expiresInSeconds: number;
  contentType?: string;
}): Promise<{ url: string; expiresAt: string }> {
  const cfg = getR2Config();
  const ttl = Math.min(300, Math.max(60, Math.floor(params.expiresInSeconds)));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalUri = `/${encodeRfc3986Path(cfg.bucket)}/${encodeRfc3986Path(params.objectKey)}`;

  const signedHeadersList = params.method === 'PUT' && params.contentType
    ? 'content-type;host'
    : 'host';
  const canonicalHeaders = params.method === 'PUT' && params.contentType
    ? `content-type:${params.contentType}\nhost:${cfg.endpointHost}\n`
    : `host:${cfg.endpointHost}\n`;

  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${cfg.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(ttl)],
    ['X-Amz-SignedHeaders', signedHeadersList],
  ];
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = queryParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersList,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const key = await signingKey(cfg.secretAccessKey, dateStamp);
  const signature = toHex(await hmacSha256(key, stringToSign));

  const url = `https://${cfg.endpointHost}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  return { url, expiresAt };
}

export async function headR2Object(objectKey: string): Promise<{ exists: boolean; contentLength: number; contentType: string }> {
  const { url } = await presignR2ObjectUrl({
    method: 'HEAD',
    objectKey,
    expiresInSeconds: 60,
  });
  const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) {
    return { exists: false, contentLength: 0, contentType: '' };
  }
  if (!response.ok) {
    throw new Error('UPSTREAM_ERROR');
  }
  return {
    exists: true,
    contentLength: Number(response.headers.get('content-length') || 0),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function fetchR2ObjectResponse(objectKey: string): Promise<Response> {
  const { url } = await presignR2ObjectUrl({
    method: 'GET',
    objectKey,
    expiresInSeconds: 120,
  });
  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(25_000) });
  if (response.status === 404) throw new Error('R2_UPLOAD_NOT_FOUND');
  if (!response.ok) throw new Error('UPSTREAM_ERROR');
  return response;
}
