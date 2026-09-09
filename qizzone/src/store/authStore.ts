import { create } from 'zustand';
import { onIdTokenChanged, type Unsubscribe } from 'firebase/auth';
import type { User, LoginCredentials, RegisterData } from '@/types/auth';
import { errorMessage } from '@/lib/cloud';
import { firebaseAuthService, syncProfile } from '@/services/firebaseAuthService';
import { firebaseAuth } from '@/lib/cloud';

interface AuthStoreState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  configurationError: string | null;
  initialize: () => Promise<Unsubscribe | undefined>;
  login: (credentials: LoginCredentials) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<User>;
  clearAuth: () => void;
}

let unsubscribe: Unsubscribe | undefined;
let initializationTimer: ReturnType<typeof setTimeout> | undefined;
let authEventVersion = 0;
let registrationContext: { fullName: string; role: 'student' | 'teacher' } | null = null;
const AUTH_STATE_TIMEOUT_MS = 10_000;

function approvalMessage(user: User): string | null {
  if (user.approvalStatus === 'pending') return 'Tài khoản giáo viên đang chờ quản trị viên xét duyệt.';
  if (user.approvalStatus === 'rejected') return 'Yêu cầu tài khoản giáo viên đã bị từ chối. Vui lòng liên hệ quản trị viên.';
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

  initialize: async () => {
    if (unsubscribe) return unsubscribe;
    const listenerVersion = ++authEventVersion;
    try {
      const auth = firebaseAuth();
      clearInitializationTimer();
      initializationTimer = setTimeout(() => {
        if (listenerVersion !== authEventVersion || get().isInitialized) return;
        unsubscribe?.();
        unsubscribe = undefined;
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          configurationError: 'Không thể khôi phục phiên Firebase. Vui lòng kiểm tra kết nối rồi tải lại trang.',
        });
      }, AUTH_STATE_TIMEOUT_MS);

      unsubscribe = onIdTokenChanged(
        auth,
        async firebaseUser => {
          clearInitializationTimer();
          const eventVersion = ++authEventVersion;
          set({ isLoading: true, configurationError: null });
          if (!firebaseUser) {
            set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true });
            return;
          }
          try {
            const context = registrationContext;
            const profile = await syncProfile(firebaseUser, context?.fullName, context?.role);
            const blockedMessage = approvalMessage(profile);
            if (blockedMessage) {
              // The register action owns sign-out and feedback while account creation is still in flight.
              if (context) return;
              await firebaseAuthService.logout().catch(() => undefined);
              set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true, configurationError: blockedMessage });
              return;
            }
            if (eventVersion !== authEventVersion) return;
            set({ user: profile, isAuthenticated: true, isLoading: false, isInitialized: true });
          } catch (error) {
            if (eventVersion !== authEventVersion) return;
            set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true, configurationError: errorMessage(error) });
          }
        },
        error => {
          clearInitializationTimer();
          authEventVersion++;
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
            configurationError: errorMessage(error),
          });
        },
      );
      return unsubscribe;
    } catch (error) {
      clearInitializationTimer();
      set({ isLoading: false, isInitialized: true, configurationError: errorMessage(error) });
      return undefined;
    }
  },

  login: async credentials => {
    set({ isLoading: true, configurationError: null });
    try {
      const result = await firebaseAuthService.login(credentials);
      const user = await syncProfile(result.user);
      const blockedMessage = approvalMessage(user);
      if (blockedMessage) {
        await firebaseAuthService.logout().catch(() => undefined);
        set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true, configurationError: blockedMessage });
        throw new Error(blockedMessage);
      }
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  register: async data => {
    set({ isLoading: true, configurationError: null });
    const requestedRole = data.role === 'teacher' ? 'teacher' : 'student';
    registrationContext = { fullName: data.fullName, role: requestedRole };
    try {
      // Public registration can request teacher, but the server keeps it pending until an admin approves it.
      const result = await firebaseAuthService.register({ ...data, role: requestedRole });
      const user = await syncProfile(result.user, data.fullName, requestedRole);
      const blockedMessage = approvalMessage(user);
      if (blockedMessage) {
        await firebaseAuthService.logout().catch(() => undefined);
        set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true, configurationError: blockedMessage });
        return user;
      }
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true });
      return user;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    } finally {
      registrationContext = null;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try { await firebaseAuthService.logout(); }
    finally { set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true }); }
  },

  resetPassword: async email => {
    try {
      await firebaseAuthService.resetPassword(email);
    } catch (error) {
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  updateProfile: async data => {
    if (!get().user) throw new Error('Chưa đăng nhập');
    set({ isLoading: true });
    try {
      const updated = await firebaseAuthService.updateProfile(data);
      set({ user: updated, isLoading: false });
      return updated;
    } catch (error) {
      set({ isLoading: false });
      throw new Error(errorMessage(error), { cause: error });
    }
  },

  clearAuth: () => {
    authEventVersion++;
    set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true });
  },
}));

export function disposeAuthListener() {
  authEventVersion++;
  clearInitializationTimer();
  unsubscribe?.();
  unsubscribe = undefined;
}

export default useAuthStore;
