import { describe, expect, it } from 'vitest';
import { mapProfile } from '@/services/firebaseAuthService';

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
