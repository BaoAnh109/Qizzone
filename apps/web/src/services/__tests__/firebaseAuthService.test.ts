import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User as SupabaseUser } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  edge: vi.fn(),
  supabaseSelect: vi.fn(),
  supabaseEq: vi.fn(),
  supabaseMaybeSingle: vi.fn(),
  refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  resend: vi.fn().mockResolvedValue({ error: null }),
  signUp: vi.fn(),
  signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/auth' }, error: null }),
  verifyOtp: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' }, session: {} }, error: null }),
}));

vi.mock('@/lib/cloud', () => ({
  edge: mocks.edge,
  rpc: vi.fn(),
  supabase: vi.fn(() => ({
    auth: {
      refreshSession: mocks.refreshSession,
      resend: mocks.resend,
      signUp: mocks.signUp,
      signInWithOAuth: mocks.signInWithOAuth,
      verifyOtp: mocks.verifyOtp,
    },
    from: vi.fn(() => ({
      select: mocks.supabaseSelect.mockReturnValue({
        eq: mocks.supabaseEq.mockReturnValue({
          maybeSingle: mocks.supabaseMaybeSingle,
        }),
      }),
    })),
  })),
}));

import { clearInFlightSync, mapProfile, supabaseAuthService, syncProfile } from '@/services/authService';

describe('supabaseAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInFlightSync();
  });

  describe('mapProfile', () => {
    it('maps a Supabase-backed profile without persisting a token', () => {
      expect(
        mapProfile({
          id: 'supabase-uid-1',
          firebase_uid: 'supabase-uid-1',
          email: 'student@example.test',
          full_name: 'Nguyễn An',
          role: 'student',
          approval_status: 'approved',
          avatar_url: 'https://example.test/avatar.png',
          created_at: '2026-09-05T00:00:00.000Z',
        }),
      ).toEqual({
        id: 'supabase-uid-1',
        email: 'student@example.test',
        fullName: 'Nguyễn An',
        name: 'Nguyễn An',
        role: 'student',
        baseRole: 'student',
        approvalStatus: 'approved',
        teacherRequestStatus: 'none',
        teacherRequestBlocked: false,
        teacherRequestedAt: undefined,
        avatarUrl: 'https://example.test/avatar.png',
        studentClass: undefined,
        createdAt: '2026-09-05T00:00:00.000Z',
      });
    });

    it('uses the provider avatar URL when the profile has not stored an avatar yet', () => {
      expect(
        mapProfile(
          {
            id: 'supabase-uid-2',
            email: 'google@example.test',
            full_name: 'Google User',
            role: 'student',
            approval_status: 'approved',
            created_at: '2026-09-05T00:00:00.000Z',
          },
          undefined,
          'https://lh3.googleusercontent.com/avatar',
        ),
      ).toMatchObject({
        avatarUrl: 'https://lh3.googleusercontent.com/avatar',
      });
    });
  });

  describe('syncProfile optimizations', () => {
    const mockUser = {
      id: 'user-123',
      email: 'vinh@example.com',
      email_confirmed_at: '2026-11-21T00:00:00.000Z',
      user_metadata: { full_name: 'Vinh Nguyen' },
      app_metadata: { app_role: 'student' },
    } as unknown as SupabaseUser;

    it('uses fast-path database query when app_metadata already holds app_role, skipping edge function', async () => {
      mocks.supabaseMaybeSingle.mockResolvedValue({
        data: {
          id: 'user-123',
          firebase_uid: 'user-123',
          email: 'vinh@example.com',
          full_name: 'Vinh Nguyen',
          role: 'student',
          approval_status: 'approved',
          created_at: '2026-09-05T00:00:00.000Z',
        },
        error: null,
      });

      const profile = await syncProfile(mockUser);

      expect(profile.id).toBe('user-123');
      expect(profile.role).toBe('student');
      expect(mocks.supabaseMaybeSingle).toHaveBeenCalledOnce();
      expect(mocks.edge).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent in-flight syncProfile calls for the same user', async () => {
      const teacherUser = {
        ...mockUser,
        app_metadata: { app_role: 'teacher' },
      } as unknown as SupabaseUser;
      mocks.supabaseMaybeSingle.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 20));
        return {
          data: {
            id: 'user-123',
            email: 'teacher@example.com',
            full_name: 'Teacher',
            role: 'teacher',
            approval_status: 'approved',
            created_at: '2026-09-05T00:00:00.000Z',
          },
          error: null,
        };
      });

      const [res1, res2, res3] = await Promise.all([
        syncProfile(teacherUser),
        syncProfile(teacherUser),
        syncProfile(teacherUser),
      ]);

      expect(res1).toBe(res2);
      expect(res2).toBe(res3);
      expect(mocks.supabaseMaybeSingle).toHaveBeenCalledOnce();
    });

    it('falls back to bootstrap-profile edge function when app_metadata claims are not yet set', async () => {
      const newUser = {
        ...mockUser,
        app_metadata: {},
      } as unknown as SupabaseUser;
      mocks.edge.mockResolvedValue({
        id: 'user-123',
        email: 'new@example.com',
        full_name: 'New User',
        role: 'student',
        approval_status: 'approved',
        active_role: 'student',
        created_at: '2026-09-05T00:00:00.000Z',
      });

      const profile = await syncProfile(newUser);

      expect(profile.id).toBe('user-123');
      expect(mocks.edge).toHaveBeenCalledWith('bootstrap-profile', expect.any(Object), 15_000);
      expect(mocks.refreshSession).toHaveBeenCalledOnce();
    });

    it('uses signup resend OTP, verifies signup OTP, rejects duplicate emails, and forwards safe Google redirects', async () => {
      await supabaseAuthService.resendSignupOtp(' student@example.test ');
      expect(mocks.resend).toHaveBeenCalledWith({
        type: 'signup',
        email: 'student@example.test',
      });

      await supabaseAuthService.verifyEmailOtp({
        email: 'student@example.test',
        token: '123456',
        type: 'signup',
      });
      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        email: 'student@example.test',
        token: '123456',
        type: 'signup',
      });

      mocks.signUp.mockResolvedValueOnce({
        data: { user: { id: 'dup-1', identities: [] }, session: null },
        error: null,
      });
      await expect(
        supabaseAuthService.register({
          fullName: 'Existing User',
          email: 'existing@example.test',
          password: 'Password1!',
          role: 'student',
        }),
      ).rejects.toThrow(/đã được đăng ký/i);

      mocks.signUp.mockResolvedValueOnce({
        data: { user: { id: 'new-1', identities: [{ id: 'id-1' }], email_confirmed_at: null }, session: null },
        error: null,
      });
      await expect(
        supabaseAuthService.register({
          fullName: 'New User',
          email: 'new@example.test',
          password: 'Password1!',
          role: 'student',
        }),
      ).resolves.toMatchObject({ needsEmailVerification: true });

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      await supabaseAuthService.loginWithGoogle('/teacher/create-quiz');
      expect(mocks.signInWithOAuth).toHaveBeenNthCalledWith(1, {
        provider: 'google',
        options: {
          redirectTo: origin ? `${origin}/login?redirect=%2Fteacher%2Fcreate-quiz` : undefined,
          queryParams: { prompt: 'select_account' },
        },
      });

      await supabaseAuthService.loginWithGoogle('//evil.com');
      expect(mocks.signInWithOAuth).toHaveBeenNthCalledWith(2, {
        provider: 'google',
        options: {
          redirectTo: origin ? `${origin}/login` : undefined,
          queryParams: { prompt: 'select_account' },
        },
      });
    });

    it('detects Google-only accounts vs password-enabled or linked accounts', async () => {
      mocks.supabaseMaybeSingle.mockResolvedValue({
        data: {
          id: 'user-oauth',
          firebase_uid: 'user-oauth',
          email: 'google-only@example.test',
          full_name: 'Google Only',
          role: 'student',
          approval_status: 'approved',
          created_at: '2026-09-05T00:00:00.000Z',
        },
        error: null,
      });

      const googleOnlyUser = {
        id: 'user-oauth',
        email: 'google-only@example.test',
        email_confirmed_at: '2026-11-21T00:00:00.000Z',
        user_metadata: {},
        app_metadata: { provider: 'google', providers: ['google'], app_role: 'student' },
      } as unknown as SupabaseUser;
      const googleProfile = await syncProfile(googleOnlyUser);
      expect(googleProfile.hasPassword).toBe(false);
      expect(googleProfile.authProviders).toEqual(['google']);

      const linkedUser = {
        ...googleOnlyUser,
        id: 'user-linked',
        app_metadata: { provider: 'google', providers: ['email', 'google'], app_role: 'student' },
      } as unknown as SupabaseUser;
      const linkedProfile = await syncProfile(linkedUser);
      expect(linkedProfile.hasPassword).toBe(true);
      expect(linkedProfile.authProviders).toEqual(['email', 'google']);
    });
  });
});
