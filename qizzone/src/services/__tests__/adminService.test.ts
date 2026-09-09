import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ edge: vi.fn() }));
vi.mock('@/lib/cloud', () => ({ edge: mocks.edge }));

import { adminService } from '@/services/adminService';

describe('admin teacher approval service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps pending teacher requests returned by the trusted Edge Function', async () => {
    mocks.edge.mockResolvedValue({ requests: [{
      firebase_uid: 'teacher-1', email: 'teacher@example.test', full_name: 'Teacher One',
      approval_status: 'pending', approval_requested_at: '2026-09-09T00:00:00.000Z',
      created_at: '2026-09-08T00:00:00.000Z',
    }] });

    await expect(adminService.listTeacherApprovals()).resolves.toEqual([{
      firebaseUid: 'teacher-1', email: 'teacher@example.test', fullName: 'Teacher One',
      status: 'pending', requestedAt: '2026-09-09T00:00:00.000Z',
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
});
