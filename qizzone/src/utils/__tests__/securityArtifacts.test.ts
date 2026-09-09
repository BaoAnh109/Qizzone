import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function filesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap(name => {
    const path = `${root}/${name}`;
    return statSync(path).isDirectory() ? filesRecursively(path) : [path];
  });
}

describe('secret boundaries', () => {
  it('keeps server-only secret names and values out of frontend source and bundle', () => {
    const project = fileURLToPath(new URL('../../../..', import.meta.url));
    const frontendFiles = [
      ...filesRecursively(`${project}/qizzone/src`).filter(path => /\.(ts|tsx)$/.test(path) && !path.includes('__tests__')),
      `${project}/qizzone/.env.example`,
      ...filesRecursively(`${project}/qizzone/dist`).filter(path => /\.(js|html|css)$/.test(path)),
    ];
    const content = frontendFiles.map(path => readFileSync(path, 'utf8')).join('\n');
    expect(content).not.toContain('VITE_GEMINI_API_KEY');
    expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(content).not.toContain('FIREBASE_SERVICE_ACCOUNT');
    expect(content).not.toMatch(/-----BEGIN PRIVATE KEY-----/);
    expect(content).not.toMatch(/sb_secret_[A-Za-z0-9_-]{16,}/);
    expect(content).not.toMatch(/AQ\.[A-Za-z0-9_-]{30,}/);
  });

  it('requires a verified Firebase teacher/admin token before reading the Gemini secret', () => {
    const functionPath = fileURLToPath(new URL('../../../../supabase/functions/extract-quiz-with-gemini/index.ts', import.meta.url));
    const source = readFileSync(functionPath, 'utf8');
    expect(source.indexOf('await identity(req)')).toBeGreaterThan(-1);
    expect(source.indexOf("['teacher','admin'].includes")).toBeGreaterThan(source.indexOf('await identity(req)'));
    expect(source.indexOf("Deno.env.get('GEMINI_API_KEY')")).toBeGreaterThan(source.indexOf("['teacher','admin'].includes"));
    expect(source).toContain('body.apiKey');
    expect(source).not.toMatch(/respond\(req,\s*\{[^}]*key\b/i);
  });

  it('keeps teacher approval and Firebase claim changes behind an approved admin check', () => {
    const functionPath = fileURLToPath(new URL('../../../../supabase/functions/manage-teacher-approvals/index.ts', import.meta.url));
    const source = readFileSync(functionPath, 'utf8');
    const identityIndex = source.indexOf('await identity(req)');
    const adminIndex = source.indexOf("actorProfile.role !== 'admin'");
    const targetIndex = source.indexOf('body.firebaseUid');
    const claimsIndex = source.indexOf('setCustomUserClaims');
    expect(identityIndex).toBeGreaterThan(-1);
    expect(adminIndex).toBeGreaterThan(identityIndex);
    expect(targetIndex).toBeGreaterThan(adminIndex);
    expect(claimsIndex).toBeGreaterThan(targetIndex);
    expect(source).not.toContain('body.role');
  });
});
