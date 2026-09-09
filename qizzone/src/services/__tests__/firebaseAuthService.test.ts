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
      approvalStatus: 'approved',
      avatarUrl: 'https://example.test/avatar.png',
      createdAt: '2026-09-05T00:00:00.000Z',
    });
  });
});
