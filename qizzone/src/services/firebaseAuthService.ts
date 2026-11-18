import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, reload, sendEmailVerification, sendPasswordResetEmail, updateProfile, type User as FirebaseUser } from 'firebase/auth';
import { edge, firebaseAuth, isQizzoneApiConfigured, qizzoneApi, rpc, supabase } from '@/lib/cloud';
import type { User, LoginCredentials, RegisterData, UserRole } from '@/types/auth';

export interface ProfileRow {
  firebase_uid: string;
  email: string;
  full_name: string;
  role: User['role'];
  approval_status: User['approvalStatus'];
  teacher_request_status?: NonNullable<User['teacherRequestStatus']> | null;
  teacher_request_blocked?: boolean | null;
  teacher_requested_at?: string | null;
  active_role?: UserRole | null;
  base_role?: UserRole | null;
  avatar_url?: string | null;
  created_at: string;
}

interface ApiProfileResponse {
  firebaseUid: string;
  email: string;
  fullName: string;
  role: UserRole;
  baseRole: UserRole;
  activeRole: UserRole;
  approvalStatus: User['approvalStatus'];
  teacherRequestStatus: NonNullable<User['teacherRequestStatus']>;
  teacherRequestBlocked: boolean;
  teacherRequestedAt: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

function asProfileRow(profile: ApiProfileResponse): ProfileRow {
  return {
    firebase_uid: profile.firebaseUid,
    email: profile.email,
    full_name: profile.fullName,
    role: profile.baseRole || profile.role,
    base_role: profile.baseRole,
    active_role: profile.activeRole,
    approval_status: profile.approvalStatus,
    teacher_request_status: profile.teacherRequestStatus,
    teacher_request_blocked: profile.teacherRequestBlocked,
    teacher_requested_at: profile.teacherRequestedAt,
    avatar_url: profile.avatarUrl,
    created_at: profile.createdAt,
  };
}

function firebaseAvatarUrl(user: FirebaseUser): string | null {
  return user.photoURL || user.providerData.find(provider => provider.photoURL)?.photoURL || null;
}

export function mapProfile(p: ProfileRow, activeRole?: UserRole, avatarFallback?: string | null, emailVerified?: boolean): User {
  const teacherRequestStatus = p.teacher_request_status === 'none' && p.role === 'teacher'
    ? p.approval_status
    : p.teacher_request_status || (p.role === 'teacher' ? 'approved' : 'none');
  return {
    id: p.firebase_uid,
    email: p.email,
    ...(emailVerified === undefined ? {} : { emailVerified }),
    fullName: p.full_name,
    name: p.full_name,
    role: p.active_role || activeRole || p.role,
    baseRole: p.base_role || p.role,
    approvalStatus: p.approval_status,
    teacherRequestStatus,
    teacherRequestBlocked: Boolean(p.teacher_request_blocked),
    teacherRequestedAt: p.teacher_requested_at || undefined,
    avatarUrl: p.avatar_url || avatarFallback || undefined,
    createdAt: p.created_at,
  };
}

const inFlightSync = new Map<string, Promise<User>>();

export function clearInFlightSync(): void {
  inFlightSync.clear();
}

export function syncProfile(user: FirebaseUser, preferredFullName?: string, requestedRole?: UserRole): Promise<User> {
  const syncKey = `${user.uid}:${preferredFullName || ''}:${requestedRole || ''}`;
  const existing = inFlightSync.get(syncKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      if (isQizzoneApiConfigured) {
        let profile = await qizzoneApi<ApiProfileResponse>('/api/v1/me');
        if (preferredFullName?.trim() && preferredFullName.trim() !== profile.fullName) {
          profile = await qizzoneApi<ApiProfileResponse>('/api/v1/me', {
            method: 'PATCH',
            body: JSON.stringify({ fullName: preferredFullName.trim() }),
          });
        }
        return mapProfile(asProfileRow(profile), profile.activeRole, firebaseAvatarUrl(user), user.emailVerified);
      }

      // 1. Fast path: For existing authenticated users returning with valid claims,
      // query Postgres directly via PostgREST (~50ms) instead of incurring Edge Function cold-start (~2-5s)
      if (!preferredFullName && !requestedRole) {
        try {
          const token = await user.getIdTokenResult();
          const claimedRole = token.claims.app_role as UserRole | undefined;
          if (token.claims.role === 'authenticated' && claimedRole) {
            const profileTable = supabase().from('profiles') as unknown as {
              select: (cols: string) => {
                eq: (col: string, val: unknown) => {
                  maybeSingle: () => Promise<{ data: ProfileRow | null; error: Error | null }>;
                };
              };
            };
            const { data: p, error } = await profileTable
              .select('*')
              .eq('firebase_uid', user.uid)
              .maybeSingle();

            if (!error && p && p.approval_status === 'approved') {
              const activeRole = p.active_role || claimedRole || p.role;
              if (activeRole === claimedRole) {
                return mapProfile(p, activeRole, firebaseAvatarUrl(user), user.emailVerified);
              }
            }
          }
        } catch {
          // If direct query fails for any reason, continue to fallback bootstrap edge function
        }
      }

      // 2. Fallback: Edge Function for initial profile bootstrap or claim synchronization
      const p = await edge<ProfileRow>('bootstrap-profile', {
        fullName: preferredFullName || user.displayName,
        overwriteName: Boolean(preferredFullName),
        requestedRole: requestedRole === 'student' ? requestedRole : 'student',
      }, 15_000);
      const token = await user.getIdTokenResult();
      const activeRole = p.active_role || (token.claims.app_role as UserRole | undefined) || p.role;
      if (p.approval_status === 'approved' && (token.claims.role !== 'authenticated' || token.claims.app_role !== activeRole)) {
        await user.getIdToken(true);
      }
      return mapProfile(p, activeRole, firebaseAvatarUrl(user), user.emailVerified);
    } finally {
      inFlightSync.delete(syncKey);
    }
  })();

  inFlightSync.set(syncKey, promise);
  return promise;
}

function currentFirebaseUser() {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('Chưa đăng nhập.');
  return user;
}

export const firebaseAuthService = {
  login: (credentials: LoginCredentials) => signInWithEmailAndPassword(firebaseAuth(), credentials.email.trim(), credentials.password),
  loginWithGoogle: () => signInWithPopup(firebaseAuth(), new GoogleAuthProvider()),
  async register(data: RegisterData) {
    const result = await createUserWithEmailAndPassword(firebaseAuth(), data.email.trim(), data.password);
    await updateProfile(result.user, { displayName: data.fullName.trim() });
    await sendEmailVerification(result.user);
    return result;
  },
  async resendEmailVerification() {
    await sendEmailVerification(currentFirebaseUser());
  },
  async refreshEmailVerification() {
    const current = currentFirebaseUser();
    await reload(current);
    await current.getIdToken(true);
    return current.emailVerified;
  },
  logout: () => signOut(firebaseAuth()),
  resetPassword: (email: string) => sendPasswordResetEmail(firebaseAuth(), email.trim()),
  async requestTeacherAccess() {
    const current = currentFirebaseUser();
    if (isQizzoneApiConfigured) {
      await qizzoneApi('/api/v1/teacher-requests', { method: 'POST' });
      const profile = await qizzoneApi<ApiProfileResponse>('/api/v1/me');
      return mapProfile(asProfileRow(profile), profile.activeRole, firebaseAvatarUrl(current), current.emailVerified);
    }
    const profile = await edge<ProfileRow>('request-teacher-role', {}, 15_000);
    return mapProfile(profile, undefined, firebaseAvatarUrl(current), current.emailVerified);
  },
  async switchRole(role: Extract<UserRole, 'student' | 'teacher'>) {
    const current = currentFirebaseUser();
    if (isQizzoneApiConfigured) {
      const profile = await qizzoneApi<ApiProfileResponse>('/api/v1/me/role', {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      return mapProfile(asProfileRow(profile), profile.activeRole, firebaseAvatarUrl(current), current.emailVerified);
    }
    const result = await edge<{ profile: ProfileRow; active_role: UserRole }>('switch-account-role', { role }, 15_000);
    await current.getIdToken(true);
    return mapProfile({ ...result.profile, active_role: result.active_role }, result.active_role, firebaseAvatarUrl(current), current.emailVerified);
  },
  async updateProfile(data: Partial<User>) {
    if (!data.fullName?.trim()) throw new Error('Vui lòng nhập họ tên.');
    const current = currentFirebaseUser();
    await updateProfile(current, { displayName: data.fullName.trim(), photoURL: data.avatarUrl || null });
    if (isQizzoneApiConfigured) {
      const profile = await qizzoneApi<ApiProfileResponse>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: data.fullName.trim() }),
      });
      return mapProfile(asProfileRow(profile), profile.activeRole, firebaseAvatarUrl(current), current.emailVerified);
    }
    return mapProfile(await rpc<ProfileRow>('update_my_profile', { p_name: data.fullName.trim(), p_avatar: data.avatarUrl || null }), undefined, firebaseAvatarUrl(current), current.emailVerified);
  },
};
