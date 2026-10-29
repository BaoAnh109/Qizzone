import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ edge: vi.fn() }));
vi.mock('@/lib/cloud', () => ({ edge: mocks.edge }));

import { adminService } from '@/services/adminService';

describe('admin teacher approval service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps pending teacher requests returned by the trusted Edge Function', async () => {
    mocks.edge.mockResolvedValue({ requests: [{
      firebase_uid: 'teacher-1', email: 'teacher@example.test', full_name: 'Teacher One',
      role: 'teacher',
      approval_status: 'pending', approval_requested_at: '2026-09-09T00:00:00.000Z',
      created_at: '2026-09-08T00:00:00.000Z',
    }] });

    await expect(adminService.listTeacherApprovals()).resolves.toEqual([{
      firebaseUid: 'teacher-1', email: 'teacher@example.test', fullName: 'Teacher One',
      status: 'pending', requestedAt: '2026-09-09T00:00:00.000Z', blocked: false, requestKind: 'legacy_teacher',
    }]);
    expect(mocks.edge).toHaveBeenCalledWith('manage-teacher-approvals', { action: 'list' }, 15_000);
  });

  it('sends only the target UID and fixed review action', async () => {
    mocks.edge.mockResolvedValue({});
    await adminService.approveTeacher('teacher-1');
    await adminService.rejectTeacher('teacher-2');
    expect(mocks.edge).toHaveBeenNthCalledWith(1, 'manage-teacher-approvals', { action: 'approve', firebaseUid: 'teacher-1' }, 15_000);
    expect(mocks.edge).toHaveBeenNthCalledWith(2, 'manage-teacher-approvals', { action: 'reject', firebaseUid: 'teacher-2' }, 15_000);
  });

  it('can block and unblock teacher requests by Firebase UID', async () => {
    mocks.edge.mockResolvedValue({});
    await adminService.setTeacherRequestBlocked('student-1', true);
    await adminService.setTeacherRequestBlocked('student-1', false);
    expect(mocks.edge).toHaveBeenNthCalledWith(1, 'manage-teacher-approvals', { action: 'set_blocked', firebaseUid: 'student-1', blocked: true }, 15_000);
    expect(mocks.edge).toHaveBeenNthCalledWith(2, 'manage-teacher-approvals', { action: 'set_blocked', firebaseUid: 'student-1', blocked: false }, 15_000);
  });

  it('lists accounts and maps returned rows correctly', async () => {
    mocks.edge.mockResolvedValue({
      accounts: [
        {
          id: 'acc-1',
          firebase_uid: 'uid-1',
          email: 'teacher@test.com',
          full_name: 'Giáo viên A',
          role: 'teacher',
          is_blocked: false,
          created_at: '2026-09-01T00:00:00.000Z',
          quiz_count: 5,
        },
      ],
    });

    const accounts = await adminService.listAccounts('teacher');
    expect(accounts).toEqual([
      {
        id: 'acc-1',
        firebaseUid: 'uid-1',
        email: 'teacher@test.com',
        fullName: 'Giáo viên A',
        role: 'teacher',
        isBlocked: false,
        createdAt: '2026-09-01T00:00:00.000Z',
        quizCount: 5,
        submissionCount: 0,
      },
    ]);
    expect(mocks.edge).toHaveBeenCalledWith(
      'manage-user-accounts',
      { action: 'list', role: 'teacher' },
      15_000
    );
  });

  it('calls edge function to toggle user blocked state', async () => {
    mocks.edge.mockResolvedValue({});
    await adminService.toggleBlockUser('user-1', true);
    expect(mocks.edge).toHaveBeenCalledWith(
      'manage-user-accounts',
      { action: 'toggle_block', userId: 'user-1', isBlocked: true },
      15_000
    );
  });
});
