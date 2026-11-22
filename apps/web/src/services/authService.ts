import type { User as SupabaseUser } from '@supabase/supabase-js';
import { edge, rpc, supabase } from '@/lib/cloud';
import type {
  LoginCredentials,
  OtpVerifyPayload,
  RegisterData,
  TeacherRequestStatus,
  User,
  UserRole,
} from '@/types/auth';

export interface ProfileRow {
  id?: string;
  firebase_uid?: string;
  email: string;
  full_name: string;
  role: UserRole;
  base_role?: UserRole;
  active_role?: UserRole | null;
  approval_status: User['approvalStatus'];
  teacher_request_status?: TeacherRequestStatus | null;
  teacher_request_blocked?: boolean | null;
  teacher_requested_at?: string | null;
  avatar_url?: string | null;
  student_class?: string | null;
  created_at: string;
}

function supabaseAvatarUrl(user: SupabaseUser): string | null {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const candidate = metadata?.avatar_url || metadata?.picture;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

export function extractAuthProviders(user: SupabaseUser): {
  authProviders: string[];
  hasPassword: boolean;
} {
  const providers = new Set<string>();
  const appMeta = (user.app_metadata || {}) as Record<string, unknown>;
  if (Array.isArray(appMeta.providers)) {
    for (const item of appMeta.providers) {
      if (typeof item === 'string' && item) providers.add(item);
    }
  }
  if (typeof appMeta.provider === 'string' && appMeta.provider) {
    providers.add(appMeta.provider);
  }
  if (Array.isArray(user.identities)) {
    for (const ident of user.identities) {
      if (typeof ident?.provider === 'string' && ident.provider) {
        providers.add(ident.provider);
      }
    }
  }
  const authProviders = [...providers];
  const hasPassword = authProviders.length === 0 ? true : authProviders.includes('email');
  return { authProviders, hasPassword };
}

export function mapProfile(p: ProfileRow, activeRole?: UserRole, avatarFallback?: string | null): User {
  const teacherRequestStatus: TeacherRequestStatus =
    p.teacher_request_status || (p.role === 'teacher' ? p.approval_status : 'none');
  const resolvedId = p.id || p.firebase_uid || '';
  return {
    id: resolvedId,
    email: p.email,
    fullName: p.full_name,
    name: p.full_name,
    role: p.active_role || activeRole || p.role,
    baseRole: p.base_role || p.role,
    approvalStatus: p.approval_status,
    teacherRequestStatus,
    teacherRequestBlocked: Boolean(p.teacher_request_blocked),
    teacherRequestedAt: p.teacher_requested_at || undefined,
    isBlocked: p.approval_status === 'rejected',
    avatarUrl: p.avatar_url || avatarFallback || undefined,
    studentClass: p.student_class || undefined,
    createdAt: p.created_at,
  };
}

const inFlightSync = new Map<string, Promise<User>>();

export function clearInFlightSync(): void {
  inFlightSync.clear();
}

export function syncProfile(
  user: SupabaseUser,
  preferredFullName?: string,
  requestedRole?: UserRole,
): Promise<User> {
  const syncKey = `${user.id}:${preferredFullName || ''}:${requestedRole || ''}`;
  const existing = inFlightSync.get(syncKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Fast path: when app_metadata already carries a server-issued active role,
      // query the profile row directly by primary key to avoid Edge cold starts.
      if (!preferredFullName && !requestedRole) {
        try {
          const appMeta = (user.app_metadata || {}) as Record<string, unknown>;
          const claimedRole = appMeta.app_role as UserRole | undefined;
          if (claimedRole) {
            const { data: p, error } = await supabase()
              .from('profiles')
              .select('*')
              .eq('firebase_uid', user.id)
              .maybeSingle<ProfileRow>();

            if (!error && p && p.approval_status === 'approved') {
              const roleMatchesAuthority =
                p.role === claimedRole ||
                (p.role === 'student' && claimedRole === 'teacher' && p.teacher_request_status === 'approved');
              if (roleMatchesAuthority) {
                const activeRole = p.active_role || claimedRole || p.role;
                return {
                  ...mapProfile(p, activeRole, supabaseAvatarUrl(user)),
                  ...extractAuthProviders(user),
                  emailVerified: Boolean(user.email_confirmed_at),
                };
              }
            }
          }
        } catch {
          // Fall back to bootstrap-profile Edge Function when direct read is unavailable.
        }
      }

      const metaName = (user.user_metadata as Record<string, unknown> | undefined)?.full_name;
      const p = await edge<ProfileRow>(
        'bootstrap-profile',
        {
          fullName: preferredFullName || (typeof metaName === 'string' ? metaName : undefined),
          overwriteName: Boolean(preferredFullName),
          requestedRole: requestedRole === 'student' ? requestedRole : 'student',
        },
        15_000,
      );
      const activeRole = p.active_role || p.role;
      if (p.approval_status === 'approved' && (user.app_metadata as Record<string, unknown> | undefined)?.app_role !== activeRole) {
        await supabase().auth.refreshSession().catch(() => undefined);
      }
      return {
        ...mapProfile(p, activeRole, supabaseAvatarUrl(user)),
        ...extractAuthProviders(user),
        emailVerified: Boolean(user.email_confirmed_at),
      };
    } finally {
      inFlightSync.delete(syncKey);
    }
  })();

  inFlightSync.set(syncKey, promise);
  return promise;
}

async function currentSupabaseUser(): Promise<SupabaseUser> {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error('Chưa đăng nhập.');
  return data.user;
}

export const supabaseAuthService = {
  async login(credentials: LoginCredentials) {
    const { data, error } = await supabase().auth.signInWithPassword({
      email: credentials.email.trim(),
      password: credentials.password,
    });
    if (error) throw error;
    if (!data.user) throw new Error('Không thể đăng nhập.');
    return { user: data.user, session: data.session };
  },

  async loginWithGoogle(redirectPath?: string | null) {
    const safeRedirect =
      redirectPath && redirectPath.startsWith('/') && !redirectPath.startsWith('//')
        ? redirectPath
        : null;
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/login${safeRedirect ? `?redirect=${encodeURIComponent(safeRedirect)}` : ''}`
        : undefined;
    const { data, error } = await supabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    return { url: data.url, user: null as SupabaseUser | null };
  },

  async resendSignupOtp(email: string) {
    const { error } = await supabase().auth.resend({
      type: 'signup',
      email: email.trim(),
    });
    if (error) throw error;
  },

  async verifyEmailOtp(payload: OtpVerifyPayload) {
    const { data, error } = await supabase().auth.verifyOtp({
      email: payload.email.trim(),
      token: payload.token.trim(),
      type: payload.type,
    });
    if (error) throw error;
    if (!data.user) throw new Error('Không thể xác minh mã OTP.');
    return { user: data.user, session: data.session };
  },

  async register(data: RegisterData) {
    const { data: result, error } = await supabase().auth.signUp({
      email: data.email.trim(),
      password: data.password,
      options: {
        data: { full_name: data.fullName.trim() },
      },
    });
    if (error) throw error;
    if (!result.user) throw new Error('Không thể tạo tài khoản.');
    if (Array.isArray(result.user.identities) && result.user.identities.length === 0) {
      throw new Error(
        'Email này đã được đăng ký. Vui lòng đăng nhập bằng mật khẩu hoặc tiếp tục với Google.',
      );
    }
    return {
      user: result.user,
      session: result.session,
      needsEmailVerification: !result.session || !result.user.email_confirmed_at,
    };
  },

  async logout(scope: 'local' | 'global' = 'local') {
    const { error } = await supabase().auth.signOut({ scope });
    if (error) throw error;
  },

  async resetPassword(email: string) {
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw error;
  },

  async updatePassword(newPassword: string) {
    const { error } = await supabase().auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  async updateEmail(newEmail: string) {
    const { error } = await supabase().auth.updateUser({ email: newEmail.trim() });
    if (error) throw error;
  },

  async requestTeacherAccess() {
    const current = await currentSupabaseUser();
    const profile = await edge<ProfileRow>('request-teacher-role', {}, 15_000);
    return mapProfile(profile, undefined, supabaseAvatarUrl(current));
  },

  async switchRole(role: Extract<UserRole, 'student' | 'teacher'>) {
    const current = await currentSupabaseUser();
    const result = await edge<{ profile: ProfileRow; active_role: UserRole }>(
      'switch-account-role',
      { role },
      15_000,
    );
    await supabase().auth.refreshSession().catch(() => undefined);
    return mapProfile(
      { ...result.profile, active_role: result.active_role },
      result.active_role,
      supabaseAvatarUrl(current),
    );
  },

  async refreshSessionAndProfile(): Promise<User | null> {
    const { data: refreshed } = await supabase().auth.refreshSession();
    const sessionUser =
      refreshed.session?.user ?? (await supabase().auth.getUser()).data.user;
    if (!sessionUser) return null;
    for (const key of Array.from(inFlightSync.keys())) {
      if (key.startsWith(`${sessionUser.id}:`)) {
        inFlightSync.delete(key);
      }
    }
    return syncProfile(sessionUser);
  },

  async updateProfile(data: Partial<User>) {
    if (!data.fullName?.trim()) throw new Error('Vui lòng nhập họ tên.');
    const current = await currentSupabaseUser();
    await supabase()
      .auth.updateUser({
        data: {
          full_name: data.fullName.trim(),
          avatar_url: data.avatarUrl || null,
        },
      })
      .catch(() => undefined);
    return mapProfile(
      await rpc<ProfileRow>('update_my_profile', {
        p_name: data.fullName.trim(),
        p_avatar: data.avatarUrl || null,
      }),
      undefined,
      supabaseAvatarUrl(current),
    );
  },
};
