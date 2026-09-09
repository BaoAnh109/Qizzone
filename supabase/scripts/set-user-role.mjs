import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';

const [, , email, role] = process.argv;
if (!email || !['student', 'teacher', 'admin'].includes(role)) {
  console.error('Usage: node set-user-role.mjs user@example.com student|teacher|admin');
  process.exit(1);
}
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecret) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Use a server-only secret key, never the publishable key.');
  process.exit(1);
}
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || './firebase-service-account.json';
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
const existing = user.customClaims || {};

// Update the database first. Because RLS requires the profile role and token
// app_role to match, this immediately fails closed for any old token.
const profileResponse = await fetch(
  `${supabaseUrl.replace(/\/$/, '')}/rest/v1/profiles?firebase_uid=eq.${encodeURIComponent(user.uid)}`,
  {
    method: 'PATCH',
    headers: {
      apikey: supabaseSecret,
      Authorization: `Bearer ${supabaseSecret}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      role,
      approval_status: 'approved',
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  },
);
if (!profileResponse.ok) {
  console.error(`Supabase profile update failed with HTTP ${profileResponse.status}.`);
  process.exit(1);
}
const updatedProfiles = await profileResponse.json();
if (!Array.isArray(updatedProfiles) || updatedProfiles.length !== 1) {
  console.error('No matching Supabase profile. Ask the user to register/sign in once before assigning a role.');
  process.exit(1);
}

const updatedClaims = {
  ...existing,
  role: 'authenticated',
  app_role: role,
  account_status: 'approved',
};
delete updatedClaims.requested_role;
await auth.setCustomUserClaims(user.uid, updatedClaims);
await auth.revokeRefreshTokens(user.uid);
console.log(`Updated ${email} (${user.uid}) to ${role} in Supabase and Firebase. The user must sign in again.`);
