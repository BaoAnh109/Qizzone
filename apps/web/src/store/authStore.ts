import { create } from 'zustand';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { LoginCredentials, OtpVerifyPayload, RegisterData, User, UserRole } from '@/types/auth';
import { errorMessage, supabase } from '@/lib/cloud';
import { supabaseAuthService, syncProfile } from '@/services/authService';

interface AuthStoreState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  configurationError: string | null;
  pendingOtpEmail: string | null;
  initialize: () => Promise<(() => void) | undefined>;
  login: (credentials: LoginCredentials) => Promise<User>;
  loginWithGoogle: (redirectPath?: string | null) => Promise<User | null>;
  resendSignupOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (payload: OtpVerifyPayload) => Promise<User>;
  register: (data: RegisterData) => Promise<User & { needsEmailVerification?: boolean }>;
  requestTeacherAccess: () => Promise<User>;
  switchRole: (role: Extract<UserRole, 'student' | 'teacher'>) => Promise<User>;
  logout: (scope?: 'local' | 'global') => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<User>;
  clearAuth: () => void;
}

let subscription: { unsubscribe: () => void } | undefined;
let initializationTimer: ReturnType<typeof setTimeout> | undefined;
let authEventVersion = 0;
let activeAuthActions = 0;
let registrationContext: { fullName: string; role: 'student' } | null = null;
const AUTH_STATE_TIMEOUT_MS = 10_000;

function approvalMessage(user: User): string | null {
  if (user.role === 'teacher' && user.approvalStatus === 'pending') {
    return 'Tài khoản giáo viên đang chờ quản trị viên xét duyệt.';
  }
  if (user.role === 'teacher' && user.approvalStatus === 'rejected') {
    return 'Yêu cầu tài khoản giáo viên đã bị từ chối. Vui lòng liên hệ quản trị viên.';
  }
  return null;
}

function clearInitializationTimer() {
  if (initializationTimer) clearTimeout(initializationTimer);
  initializationTimer = undefined;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  isInitialized: false,
  configurationError: null,
  pendingOtpEmail: null,

  initialize: async () => {
    if (subscription) return () => subscription?.unsubscribe();
    const listenerVersion = ++authEventVersion;

    const handleSessionUser = async (sessionUser: SupabaseUser | null) => {
      clearInitializationTimer();
      const eventVersion = ++authEventVersion;
      if (!sessionUser) {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: null,
        });
        return;
      }

      const existingUser = get().user;
      if (existingUser && existingUser.id === sessionUser.id && get().isAuthenticated && !registrationContext) {
        set({ isLoading: false, isInitialized: true });
        return;
      }

      set({ isLoading: true, configurationError: null });
      try {
        const context = registrationContext;
        const profile = await syncProfile(sessionUser, context?.fullName, context?.role);
        const blockedMessage = approvalMessage(profile);
        if (blockedMessage) {
          if (context) return;
          await supabaseAuthService.logout().catch(() => undefined);
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
            configurationError: blockedMessage,
          });
          return;
        }
        if (eventVersion !== authEventVersion) return;
        set({
          user: profile,
          isAuthenticated: true,
          isLoading: false,
          isInitialized: true,
          pendingOtpEmail: null,
        });
      } catch (error) {
        if (eventVersion !== authEventVersion) return;
        const currentUser = get().user;
        if (currentUser && /fetch|network|timeout|connection/i.test(errorMessage(error))) {
          set({ isLoading: false, isInitialized: true });
        } else {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
            configurationError: errorMessage(error),
          });
        }
      }
    };

    try {
      const client = supabase();
      clearInitializationTimer();
      initializationTimer = setTimeout(() => {
        if (listenerVersion !== authEventVersion || get().isInitialized) return;
        subscription?.unsubscribe();
        subscription = undefined;
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: 'Không thể khôi phục phiên đăng nhập Supabase. Vui lòng kiểm tra kết nối rồi tải lại trang.',
        });
      }, AUTH_STATE_TIMEOUT_MS);

      const { data: listenerData } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') return;
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && activeAuthActions > 0) {
          return;
        }
        if (
          event === 'TOKEN_REFRESHED' &&
          get().isAuthenticated &&
          session?.user &&
          get().user?.id === session.user.id
        ) {
          return;
        }
        void handleSessionUser(session?.user ?? null);
      });
      subscription = listenerData.subscription;

      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) {
        clearInitializationTimer();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: errorMessage(sessionError),
        });
      } else {
        await handleSessionUser(sessionData.session?.user ?? null);
      }

      return () => {
        subscription?.unsubscribe();
        subscription = undefined;
      };
    } catch (error) {
      clearInitializationTimer();
      set({ isLoading: false, isInitialized: true, configurationError: errorMessage(error) });
      return undefined;
    }
  },

  login: async credentials => {
    set({ isLoading: true, configurationError: null });
    activeAuthActions++;
    try {
      const result = await supabaseAuthService.login(credentials);
      const user = await syncProfile(result.user);
      const blockedMessage = approvalMessage(user);
      if (blockedMessage) {
        await supabaseAuthService.logout().catch(() => undefined);
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: blockedMessage,
        });
        throw new Error(blockedMessage);
      }
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true, pendingOtpEmail: null });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    } finally {
      activeAuthActions = Math.max(0, activeAuthActions - 1);
    }
  },

  loginWithGoogle: async redirectPath => {
    set({ isLoading: true, configurationError: null });
    try {
      const result = await supabaseAuthService.loginWithGoogle(redirectPath);
      if (!result.user) {
        // OAuth redirect is in progress; keep state clean until callback returns.
        set({ isLoading: false });
        return null;
      }
      const user = await syncProfile(result.user);
      const blockedMessage = approvalMessage(user);
      if (blockedMessage) {
        await supabaseAuthService.logout().catch(() => undefined);
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: blockedMessage,
        });
        throw new Error(blockedMessage);
      }
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  resendSignupOtp: async email => {
    set({ isLoading: true, configurationError: null });
    try {
      await supabaseAuthService.resendSignupOtp(email);
      set({ isLoading: false, pendingOtpEmail: email.trim() });
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  verifyEmailOtp: async payload => {
    set({ isLoading: true, configurationError: null });
    activeAuthActions++;
    try {
      const result = await supabaseAuthService.verifyEmailOtp(payload);
      if (!result.user) throw new Error('Không thể xác minh mã OTP.');
      const user = await syncProfile(result.user);
      const blockedMessage = approvalMessage(user);
      if (blockedMessage) {
        await supabaseAuthService.logout().catch(() => undefined);
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: blockedMessage,
        });
        throw new Error(blockedMessage);
      }
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true, pendingOtpEmail: null });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    } finally {
      activeAuthActions = Math.max(0, activeAuthActions - 1);
    }
  },

  register: async data => {
    set({ isLoading: true, configurationError: null });
    const requestedRole = 'student' as const;
    registrationContext = { fullName: data.fullName, role: requestedRole };
    activeAuthActions++;
    try {
      const result = await supabaseAuthService.register({ ...data, role: requestedRole });
      if (result.needsEmailVerification) {
        set({ isLoading: false, isInitialized: true, pendingOtpEmail: data.email.trim() });
        return {
          id: result.user.id,
          email: data.email.trim(),
          fullName: data.fullName.trim(),
          role: 'student',
          approvalStatus: 'approved',
          createdAt: new Date().toISOString(),
          needsEmailVerification: true,
        };
      }
      const user = await syncProfile(result.user, data.fullName, requestedRole);
      const blockedMessage = approvalMessage(user);
      if (blockedMessage) {
        await supabaseAuthService.logout().catch(() => undefined);
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: blockedMessage,
        });
        return user;
      }
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    } finally {
      activeAuthActions = Math.max(0, activeAuthActions - 1);
      registrationContext = null;
    }
  },

  requestTeacherAccess: async () => {
    set({ isLoading: true, configurationError: null });
    try {
      const user = await supabaseAuthService.requestTeacherAccess();
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  switchRole: async role => {
    set({ isLoading: true, configurationError: null });
    try {
      const user = await supabaseAuthService.switchRole(role);
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  logout: async scope => {
    set({ isLoading: true });
    try {
      await supabaseAuthService.logout(scope);
    } finally {
      set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true, pendingOtpEmail: null });
    }
  },

  resetPassword: async email => {
    try {
      await supabaseAuthService.resetPassword(email);
    } catch (error) {
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  updateProfile: async data => {
    if (!get().user) throw new Error('Chưa đăng nhập');
    set({ isLoading: true });
    try {
      const updated = await supabaseAuthService.updateProfile(data);
      set({ user: updated, isLoading: false });
      return updated;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  clearAuth: () => {
    authEventVersion++;
    set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true, pendingOtpEmail: null });
  },
}));

export function disposeAuthListener() {
  authEventVersion++;
  activeAuthActions = 0;
  clearInitializationTimer();
  subscription?.unsubscribe();
  subscription = undefined;
}

export default useAuthStore;
