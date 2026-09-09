import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile, type User as FirebaseUser } from 'firebase/auth';
import { edge, firebaseAuth, rpc } from '@/lib/cloud';
import type { User, LoginCredentials, RegisterData, UserRole } from '@/types/auth';

export interface ProfileRow { firebase_uid: string; email: string; full_name: string; role: User['role']; approval_status: User['approvalStatus']; avatar_url?: string | null; created_at: string }
export function mapProfile(p: ProfileRow): User {
  return { id: p.firebase_uid, email: p.email, fullName: p.full_name, name: p.full_name, role: p.role, approvalStatus: p.approval_status, avatarUrl: p.avatar_url || undefined, createdAt: p.created_at };
}
export async function syncProfile(user: FirebaseUser, preferredFullName?: string, requestedRole?: UserRole): Promise<User> {
  const p = await edge<ProfileRow>('bootstrap-profile', {
    fullName: preferredFullName || user.displayName,
    overwriteName: Boolean(preferredFullName),
    requestedRole: requestedRole === 'teacher' ? 'teacher' : 'student',
  }, 15_000);
  const token = await user.getIdTokenResult();
  if (p.approval_status === 'approved' && (token.claims.role !== 'authenticated' || token.claims.app_role !== p.role)) await user.getIdToken(true);
  return mapProfile(p);
}
export const firebaseAuthService = {
  login: (credentials: LoginCredentials) => signInWithEmailAndPassword(firebaseAuth(), credentials.email.trim(), credentials.password),
  async register(data: RegisterData) {
    const result = await createUserWithEmailAndPassword(firebaseAuth(), data.email.trim(), data.password);
    await updateProfile(result.user, { displayName: data.fullName.trim() });
    return result;
  },
  logout: () => signOut(firebaseAuth()),
  resetPassword: (email: string) => sendPasswordResetEmail(firebaseAuth(), email.trim()),
  async updateProfile(data: Partial<User>) {
    if (!data.fullName?.trim()) throw new Error('Vui lòng nhập họ tên.');
    const current = firebaseAuth().currentUser;
    if (!current) throw new Error('Chưa đăng nhập.');
    await updateProfile(current, { displayName: data.fullName.trim(), photoURL: data.avatarUrl || null });
    return mapProfile(await rpc<ProfileRow>('update_my_profile', { p_name: data.fullName.trim(), p_avatar: data.avatarUrl || null }));
  },
};
