import fs from 'node:fs';
import path from 'node:path';

export interface E2eEnv {
  supabaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  baseUrl: string;
}

const REPO_ROOT = path.resolve(__dirname, '../../..');

function parseDotEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const result: Record<string, string> = {};

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      result[key] = value;
    }
  }

  return result;
}

let cachedEnv: E2eEnv | null = null;

export function loadE2eEnv(): E2eEnv {
  if (cachedEnv) return cachedEnv;

  const webLocal = parseDotEnvFile(path.join(REPO_ROOT, 'apps', 'web', '.env.local'));
  const e2eLocal = parseDotEnvFile(path.join(REPO_ROOT, '.env.e2e.local'));

  const supabaseUrl = (
    process.env.E2E_SUPABASE_URL ||
    e2eLocal.E2E_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    webLocal.VITE_SUPABASE_URL ||
    ''
  ).trim();

  const publishableKey = (
    process.env.E2E_SUPABASE_PUBLISHABLE_KEY ||
    e2eLocal.E2E_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    webLocal.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  const serviceRoleKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    e2eLocal.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('E2E_SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!publishableKey) missing.push('E2E_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY)');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Missing required E2E environment variables: ${missing.join(', ')}. ` +
        `Populate gitignored .env.e2e.local at repo root (and apps/web/.env.local) before running E2E tests.`
    );
  }

  const baseUrl = (process.env.E2E_BASE_URL || 'http://localhost:5173').trim();

  cachedEnv = {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    publishableKey,
    serviceRoleKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
  };

  return cachedEnv;
}
