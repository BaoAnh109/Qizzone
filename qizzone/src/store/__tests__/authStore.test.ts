import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: undefined as undefined | ((user: unknown) => Promise<void>),
  errorListener: undefined as undefined | ((error: Error) => void),
  unsubscribe: vi.fn(),
  onIdTokenChanged: vi.fn(),
  firebaseAuth: vi.fn(() => ({ currentUser: null })),
  syncProfile: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('firebase/auth', () => ({ onIdTokenChanged: mocks.onIdTokenChanged }));
vi.mock('@/lib/cloud', () => ({
  firebaseAuth: mocks.firebaseAuth,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : 'error',
}));
vi.mock('@/services/firebaseAuthService', () => ({
  syncProfile: mocks.syncProfile,
  firebaseAuthService: {
    login: mocks.login,
    register: mocks.register,
    logout: mocks.logout,
    resetPassword: mocks.resetPassword,
    updateProfile: mocks.updateProfile,
  },
}));

import { disposeAuthListener, useAuthStore } from '@/store/authStore';
import type { User } from '@/types/auth';

const profile: User = {
  id: 'firebase-user', email: 'student@example.test', fullName: 'Student', name: 'Student',
  role: 'student', approvalStatus: 'approved', createdAt: '2026-09-05T00:00:00.000Z',
};
const firebaseUser = { getIdToken: vi.fn().mockResolvedValue('firebase-id-token') };

describe('Firebase auth store', () => {
  beforeEach(() => {
    disposeAuthListener();
    vi.clearAllMocks();
    mocks.listener = undefined;
    mocks.errorListener = undefined;
    mocks.onIdTokenChanged.mockImplementation((_auth, listener, errorListener) => {
      mocks.listener = listener;
      mocks.errorListener = errorListener;
      return mocks.unsubscribe;
    });
    mocks.syncProfile.mockResolvedValue(profile);
    mocks.logout.mockResolvedValue(undefined);
    mocks.resetPassword.mockResolvedValue(undefined);
    useAuthStore.setState({
      user: null, isAuthenticated: false, isLoading: true,
      isInitialized: false, configurationError: null,
    });
  });

  it('restores a Firebase session before marking auth initialized', async () => {
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().isInitialized).toBe(false);
    await mocks.listener?.(firebaseUser);
    expect(useAuthStore.getState()).toMatchObject({
      user: profile, isAuthenticated: true,
      isLoading: false, isInitialized: true,
    });
    await mocks.listener?.(null);
    expect(useAuthStore.getState()).toMatchObject({
      user: null, isAuthenticated: false, isInitialized: true,
    });
  });

  it('subscribes again after the StrictMode setup-cleanup-setup cycle', async () => {
    await useAuthStore.getState().initialize();
    disposeAuthListener();
    await useAuthStore.getState().initialize();

    expect(mocks.onIdTokenChanged).toHaveBeenCalledTimes(2);
    await mocks.listener?.(null);
    expect(useAuthStore.getState()).toMatchObject({
      user: null, isAuthenticated: false, isLoading: false, isInitialized: true,
    });
  });

  it('finishes initialization when the Firebase observer reports an error', async () => {
    await useAuthStore.getState().initialize();
    mocks.errorListener?.(new Error('Firebase observer failed'));

    expect(useAuthStore.getState()).toMatchObject({
      user: null, isAuthenticated: false, isLoading: false,
      isInitialized: true, configurationError: 'Firebase observer failed',
    });
  });

  it('does not leave the application loading forever when Firebase stays silent', async () => {
    vi.useFakeTimers();
    try {
      await useAuthStore.getState().initialize();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(useAuthStore.getState()).toMatchObject({
        user: null, isAuthenticated: false, isLoading: false, isInitialized: true,
      });
      expect(useAuthStore.getState().configurationError).toContain('Không thể khôi phục phiên Firebase');
    } finally {
      disposeAuthListener();
      vi.useRealTimers();
    }
  });

  it('does not allow public registration to request the admin role', async () => {
    mocks.register.mockResolvedValue({ user: firebaseUser });
    await useAuthStore.getState().register({
      fullName: 'New User', email: 'new@example.test', password: '123456', role: 'admin',
    });
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ role: 'student' }));
    expect(useAuthStore.getState().user?.role).toBe('student');
  });

  it('keeps a teacher registration signed out until an admin approves it', async () => {
    const pendingTeacher: User = { ...profile, role: 'teacher', approvalStatus: 'pending' };
    mocks.register.mockResolvedValue({ user: firebaseUser });
    mocks.syncProfile.mockResolvedValueOnce(pendingTeacher);

    const result = await useAuthStore.getState().register({
      fullName: 'New Teacher', email: 'teacher@example.test', password: '123456', role: 'teacher',
    });

    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ role: 'teacher' }));
    expect(mocks.syncProfile).toHaveBeenCalledWith(firebaseUser, 'New Teacher', 'teacher');
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(result.approvalStatus).toBe('pending');
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it('preserves the teacher request when Firebase emits auth state during registration', async () => {
    const pendingTeacher: User = { ...profile, role: 'teacher', approvalStatus: 'pending' };
    await useAuthStore.getState().initialize();
    mocks.syncProfile.mockResolvedValue(pendingTeacher);
    mocks.register.mockImplementation(async () => {
      await mocks.listener?.(firebaseUser);
      return { user: firebaseUser };
    });

    await useAuthStore.getState().register({
      fullName: 'Concurrent Teacher', email: 'teacher@example.test', password: '123456', role: 'teacher',
    });

    expect(mocks.syncProfile).toHaveBeenNthCalledWith(1, firebaseUser, 'Concurrent Teacher', 'teacher');
    expect(mocks.syncProfile).toHaveBeenNthCalledWith(2, firebaseUser, 'Concurrent Teacher', 'teacher');
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it('rejects login while a teacher account is still pending approval', async () => {
    mocks.login.mockResolvedValue({ user: firebaseUser });
    mocks.syncProfile.mockResolvedValueOnce({ ...profile, role: 'teacher', approvalStatus: 'pending' });

    await expect(useAuthStore.getState().login({
      email: 'teacher@example.test', password: '123456',
    })).rejects.toThrow(/chờ quản trị viên xét duyệt/i);

    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it('delegates logout to Firebase and removes local UI state', async () => {
    useAuthStore.setState({ user: profile, isAuthenticated: true, isLoading: false });
    await useAuthStore.getState().logout();
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it('delegates password reset without storing credentials', async () => {
    await useAuthStore.getState().resetPassword('student@example.test');
    expect(mocks.resetPassword).toHaveBeenCalledWith('student@example.test');
  });
});
