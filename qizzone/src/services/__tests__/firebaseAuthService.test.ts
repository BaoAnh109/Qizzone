import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User as FirebaseUser } from 'firebase/auth';

const mocks = vi.hoisted(() => ({
  edge: vi.fn(),
  supabaseSelect: vi.fn(),
  supabaseEq: vi.fn(),
  supabaseMaybeSingle: vi.fn(),
}));

vi.mock('@/lib/cloud', () => ({
  edge: mocks.edge,
  firebaseAuth: vi.fn(),
  rpc: vi.fn(),
  supabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mocks.supabaseSelect.mockReturnValue({
        eq: mocks.supabaseEq.mockReturnValue({
          maybeSingle: mocks.supabaseMaybeSingle,
        }),
      }),
    })),
  })),
}));

import { clearInFlightSync, mapProfile, syncProfile } from '@/services/firebaseAuthService';

describe('firebaseAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInFlightSync();
  });

  describe('mapProfile', () => {
    it('maps a Firebase-backed profile without persisting a token', () => {
      expect(mapProfile({
        firebase_uid: 'firebase-uid-1',
        email: 'student@example.test',
        full_name: 'Nguyễn An',
        role: 'student',
        approval_status: 'approved',
        avatar_url: 'https://example.test/avatar.png',
        created_at: '2026-09-05T00:00:00.000Z',
      })).toEqual({
        id: 'firebase-uid-1',
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
        createdAt: '2026-09-05T00:00:00.000Z',
      });
    });

    it('uses the Firebase photo URL when the profile has not stored an avatar yet', () => {
      expect(mapProfile({
        firebase_uid: 'firebase-uid-2',
        email: 'google@example.test',
        full_name: 'Google User',
        role: 'student',
        approval_status: 'approved',
        created_at: '2026-09-05T00:00:00.000Z',
      }, undefined, 'https://lh3.googleusercontent.com/avatar')).toMatchObject({
        avatarUrl: 'https://lh3.googleusercontent.com/avatar',
      });
    });
  });

  describe('syncProfile optimizations', () => {
    const mockUser = {
      uid: 'user-123',
      displayName: 'Vinh Nguyen',
      photoURL: null,
      providerData: [],
      getIdTokenResult: vi.fn(),
      getIdToken: vi.fn(),
    } as unknown as FirebaseUser;

    it('uses fast-path database query when claims are already authenticated, skipping edge function', async () => {
      (mockUser.getIdTokenResult as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        claims: { role: 'authenticated', app_role: 'student' },
      });
      mocks.supabaseMaybeSingle.mockResolvedValue({
        data: {
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
      expect(mockUser.getIdToken).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent in-flight syncProfile calls for the same user', async () => {
      (mockUser.getIdTokenResult as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        claims: { role: 'authenticated', app_role: 'teacher' },
      });
      mocks.supabaseMaybeSingle.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 20));
        return {
          data: {
            firebase_uid: 'user-123',
            email: 'teacher@example.com',
            full_name: 'Teacher',
            role: 'teacher',
            approval_status: 'approved',
            created_at: '2026-09-05T00:00:00.000Z',
          },
          error: null,
        };
      });

      // Fire 3 simultaneous calls (simulating login() + onIdTokenChanged + component mount)
      const [res1, res2, res3] = await Promise.all([
        syncProfile(mockUser),
        syncProfile(mockUser),
        syncProfile(mockUser),
      ]);

      expect(res1).toBe(res2);
      expect(res2).toBe(res3);
      expect(mocks.supabaseMaybeSingle).toHaveBeenCalledOnce();
    });

    it('falls back to bootstrap-profile edge function when claims are not yet set', async () => {
      (mockUser.getIdTokenResult as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        claims: {}, // Unauthenticated or new user
      });
      mocks.edge.mockResolvedValue({
        firebase_uid: 'user-123',
        email: 'new@example.com',
        full_name: 'New User',
        role: 'student',
        approval_status: 'approved',
        active_role: 'student',
        created_at: '2026-09-05T00:00:00.000Z',
      });
      (mockUser.getIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('new-token');

      const profile = await syncProfile(mockUser);

      expect(profile.id).toBe('user-123');
      expect(mocks.edge).toHaveBeenCalledWith('bootstrap-profile', expect.any(Object), 15_000);
      expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
    });
  });
});
