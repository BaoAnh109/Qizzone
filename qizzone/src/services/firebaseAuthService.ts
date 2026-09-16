import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, sendPasswordResetEmail, updateProfile, type User as FirebaseUser } from 'firebase/auth';
import { edge, firebaseAuth, rpc } from '@/lib/cloud';
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

function firebaseAvatarUrl(user: FirebaseUser): string | null {
  return user.photoURL || user.providerData.find(provider => provider.photoURL)?.photoURL || null;
}

export function mapProfile(p: ProfileRow, activeRole?: UserRole, avatarFallback?: string | null): User {
  const teacherRequestStatus = p.teacher_request_status === 'none' && p.role === 'teacher'
    ? p.approval_status
    : p.teacher_request_status || (p.role === 'teacher' ? 'approved' : 'none');
  return {
    id: p.firebase_uid,
    email: p.email,
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

export async function syncProfile(user: FirebaseUser, preferredFullName?: string, requestedRole?: UserRole): Promise<User> {
  const p = await edge<ProfileRow>('bootstrap-profile', {
    fullName: preferredFullName || user.displayName,
    overwriteName: Boolean(preferredFullName),
    requestedRole: requestedRole === 'student' ? requestedRole : 'student',
  }, 15_000);
  const token = await user.getIdTokenResult();
  const activeRole = p.active_role || (token.claims.app_role as UserRole | undefined) || p.role;
  if (p.approval_status === 'approved' && (token.claims.role !== 'authenticated' || token.claims.app_role !== activeRole)) await user.getIdToken(true);
  return mapProfile(p, activeRole, firebaseAvatarUrl(user));
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
    return result;
  },
  logout: () => signOut(firebaseAuth()),
  resetPassword: (email: string) => sendPasswordResetEmail(firebaseAuth(), email.trim()),
  async requestTeacherAccess() {
    const current = currentFirebaseUser();
    const profile = await edge<ProfileRow>('request-teacher-role', {}, 15_000);
    return mapProfile(profile, undefined, firebaseAvatarUrl(current));
  },
  async switchRole(role: Extract<UserRole, 'student' | 'teacher'>) {
    const current = currentFirebaseUser();
    const result = await edge<{ profile: ProfileRow; active_role: UserRole }>('switch-account-role', { role }, 15_000);
    await current.getIdToken(true);
    return mapProfile({ ...result.profile, active_role: result.active_role }, result.active_role, firebaseAvatarUrl(current));
  },
  async updateProfile(data: Partial<User>) {
    if (!data.fullName?.trim()) throw new Error('Vui lòng nhập họ tên.');
    const current = currentFirebaseUser();
    await updateProfile(current, { displayName: data.fullName.trim(), photoURL: data.avatarUrl || null });
    return mapProfile(await rpc<ProfileRow>('update_my_profile', { p_name: data.fullName.trim(), p_avatar: data.avatarUrl || null }), undefined, firebaseAvatarUrl(current));
  },
};
