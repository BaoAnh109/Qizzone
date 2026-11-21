import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: string, session: { user: unknown } | null) => void),
  unsubscribe: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  syncProfile: vi.fn(),
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  resendSignupOtp: vi.fn(),
  verifyEmailOtp: vi.fn(),
  register: vi.fn(),
  requestTeacherAccess: vi.fn(),
  switchRole: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('@/lib/cloud', () => ({
  supabase: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  }),
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'error'),
}));

vi.mock('@/services/authService', () => ({
  syncProfile: mocks.syncProfile,
  supabaseAuthService: {
    login: mocks.login,
    loginWithGoogle: mocks.loginWithGoogle,
    resendSignupOtp: mocks.resendSignupOtp,
    verifyEmailOtp: mocks.verifyEmailOtp,
    register: mocks.register,
    requestTeacherAccess: mocks.requestTeacherAccess,
    switchRole: mocks.switchRole,
    logout: mocks.logout,
    resetPassword: mocks.resetPassword,
    updateProfile: mocks.updateProfile,
  },
}));

import { disposeAuthListener, useAuthStore } from '@/store/authStore';
import type { User } from '@/types/auth';

const profile: User = {
  id: 'supabase-user',
  email: 'student@example.test',
  fullName: 'Student',
  name: 'Student',
  role: 'student',
  approvalStatus: 'approved',
  createdAt: '2026-09-05T00:00:00.000Z',
};
const supabaseUser = { id: 'supabase-user', email: 'student@example.test' };

describe('Supabase auth store', () => {
  beforeEach(() => {
    disposeAuthListener();
    vi.clearAllMocks();
    mocks.listener = undefined;
    mocks.onAuthStateChange.mockImplementation(listener => {
      mocks.listener = listener;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.syncProfile.mockResolvedValue(profile);
    mocks.logout.mockResolvedValue(undefined);
    mocks.resetPassword.mockResolvedValue(undefined);
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      isInitialized: false,
      configurationError: null,
      pendingOtpEmail: null,
    });
  });

  it('restores a Supabase session before marking auth initialized', async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: { user: supabaseUser } }, error: null });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({
      user: profile,
      isAuthenticated: true,
      isLoading: false,
      isInitialized: true,
    });
    mocks.listener?.('SIGNED_OUT', null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isInitialized: true,
    });
  });

  it('does not re-invoke syncProfile or flicker isLoading on background token refresh', async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: { user: supabaseUser } }, error: null });
    await useAuthStore.getState().initialize();
    expect(mocks.syncProfile).toHaveBeenCalledTimes(1);

    mocks.listener?.('TOKEN_REFRESHED', { user: supabaseUser });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.syncProfile).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      user: profile,
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('subscribes again after the StrictMode setup-cleanup-setup cycle', async () => {
    await useAuthStore.getState().initialize();
    disposeAuthListener();
    await useAuthStore.getState().initialize();

    expect(mocks.onAuthStateChange).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: true,
    });
  });

  it('does not leave the application loading forever when getSession hangs', async () => {
    vi.useFakeTimers();
    try {
      mocks.getSession.mockReturnValue(new Promise(() => {}));
      void useAuthStore.getState().initialize();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(useAuthStore.getState()).toMatchObject({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isInitialized: true,
      });
      expect(useAuthStore.getState().configurationError).toContain('Không thể khôi phục phiên đăng nhập Supabase');
    } finally {
      disposeAuthListener();
      vi.useRealTimers();
    }
  });

  it('does not allow public registration to request the admin role', async () => {
    mocks.register.mockResolvedValue({ user: supabaseUser, needsEmailVerification: false });
    await useAuthStore.getState().register({
      fullName: 'New User',
      email: 'new@example.test',
      password: 'Password1!',
      role: 'admin',
    });
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ role: 'student' }));
    expect(useAuthStore.getState().user?.role).toBe('student');
  });

  it('handles OTP email verification flow during signup and resend', async () => {
    mocks.register.mockResolvedValue({ user: supabaseUser, needsEmailVerification: true });
    mocks.resendSignupOtp.mockResolvedValue(undefined);
    const regResult = await useAuthStore.getState().register({
      fullName: 'OTP Student',
      email: 'otp@example.test',
      password: 'Password1!',
      role: 'student',
    });
    expect(regResult.needsEmailVerification).toBe(true);
    expect(useAuthStore.getState().pendingOtpEmail).toBe('otp@example.test');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    await useAuthStore.getState().resendSignupOtp('otp@example.test');
    expect(mocks.resendSignupOtp).toHaveBeenCalledWith('otp@example.test');

    mocks.verifyEmailOtp.mockResolvedValue({ user: supabaseUser, session: {} });
    const verified = await useAuthStore.getState().verifyEmailOtp({
      email: 'otp@example.test',
      token: '123456',
      type: 'signup',
    });
    expect(verified).toEqual(profile);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().pendingOtpEmail).toBeNull();
  });

  it('rejects login while a teacher account is still pending approval', async () => {
    mocks.login.mockResolvedValue({ user: supabaseUser });
    mocks.syncProfile.mockResolvedValueOnce({ ...profile, role: 'teacher', approvalStatus: 'pending' });

    await expect(
      useAuthStore.getState().login({ email: 'teacher@example.test', password: 'Password1!' }),
    ).rejects.toThrow(/chờ quản trị viên xét duyệt/i);

    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it('supports student teacher-access request, role switch, logout, and password reset', async () => {
    const pendingStudent = { ...profile, teacherRequestStatus: 'pending' as const };
    mocks.requestTeacherAccess.mockResolvedValue(pendingStudent);
    await expect(useAuthStore.getState().requestTeacherAccess()).resolves.toEqual(pendingStudent);

    const teacher = {
      ...profile,
      role: 'teacher' as const,
      baseRole: 'student' as const,
      teacherRequestStatus: 'approved' as const,
    };
    mocks.switchRole.mockResolvedValue(teacher);
    await expect(useAuthStore.getState().switchRole('teacher')).resolves.toEqual(teacher);

    await useAuthStore.getState().logout();
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });

    await useAuthStore.getState().resetPassword('student@example.test');
    expect(mocks.resetPassword).toHaveBeenCalledWith('student@example.test');
  });

  it('ignores INITIAL_SESSION and duplicate SIGNED_IN/TOKEN_REFRESHED events during active login', async () => {
    await useAuthStore.getState().initialize();
    expect(mocks.syncProfile).not.toHaveBeenCalled();

    mocks.listener?.('INITIAL_SESSION', { user: supabaseUser });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.syncProfile).not.toHaveBeenCalled();

    mocks.login.mockImplementation(async () => {
      mocks.listener?.('SIGNED_IN', { user: supabaseUser });
      mocks.listener?.('TOKEN_REFRESHED', { user: supabaseUser });
      return { user: supabaseUser };
    });

    await useAuthStore.getState().login({ email: 'student@example.test', password: 'Password1!' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.syncProfile).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      user: profile,
      isAuthenticated: true,
      isLoading: false,
    });
  });
});
