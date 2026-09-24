import { edge } from '@/lib/cloud';

interface TeacherApprovalRow {
  firebase_uid: string;
  email: string;
  full_name: string;
  approval_status: 'pending';
  approval_requested_at: string | null;
  created_at: string;
}

export interface TeacherApprovalRequest {
  firebaseUid: string;
  email: string;
  fullName: string;
  status: 'pending';
  requestedAt: string;
}

export interface AccountRow {
  id?: string;
  firebase_uid: string;
  email: string;
  full_name: string;
  role: 'teacher' | 'student';
  is_blocked: boolean;
  created_at: string;
  quiz_count?: number;
  submission_count?: number;
}

export interface UserAccount {
  id: string;
  firebaseUid: string;
  email: string;
  fullName: string;
  role: 'teacher' | 'student';
  isBlocked: boolean;
  createdAt: string;
  quizCount?: number;
  submissionCount?: number;
}

function mapRequest(row: TeacherApprovalRow): TeacherApprovalRequest {
  return {
    firebaseUid: row.firebase_uid,
    email: row.email,
    fullName: row.full_name,
    status: row.approval_status,
    requestedAt: row.approval_requested_at || row.created_at,
  };
}

function mapAccount(row: AccountRow): UserAccount {
  return {
    id: row.id || row.firebase_uid,
    firebaseUid: row.firebase_uid,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isBlocked: !!row.is_blocked,
    createdAt: row.created_at,
    quizCount: row.quiz_count ?? 0,
    submissionCount: row.submission_count ?? 0,
  };
}

const DEFAULT_MOCK_ACCOUNTS: UserAccount[] = [
  {
    id: 'user-tea-001',
    firebaseUid: 'user-tea-001',
    email: 'teacher@example.com',
    fullName: 'Nguyễn Văn Thầy',
    role: 'teacher',
    isBlocked: false,
    createdAt: '2026-09-01T08:00:00.000Z',
    quizCount: 4,
    submissionCount: 0,
  },
  {
    id: 'user-tea-002',
    firebaseUid: 'user-tea-002',
    email: 'teacher2@example.com',
    fullName: 'Trần Thị Cô',
    role: 'teacher',
    isBlocked: false,
    createdAt: '2026-09-05T09:30:00.000Z',
    quizCount: 2,
    submissionCount: 0,
  },
  {
    id: 'user-stu-001',
    firebaseUid: 'user-stu-001',
    email: 'student@example.com',
    fullName: 'Lê Văn Trò',
    role: 'student',
    isBlocked: false,
    createdAt: '2026-09-02T10:15:00.000Z',
    quizCount: 0,
    submissionCount: 5,
  },
  {
    id: 'user-stu-002',
    firebaseUid: 'user-stu-002',
    email: 'student2@example.com',
    fullName: 'Phạm Thị Học',
    role: 'student',
    isBlocked: false,
    createdAt: '2026-09-03T14:20:00.000Z',
    quizCount: 0,
    submissionCount: 3,
  },
  {
    id: 'user-stu-003',
    firebaseUid: 'user-stu-003',
    email: 'student3@example.com',
    fullName: 'Hoàng Minh Đức',
    role: 'student',
    isBlocked: true,
    createdAt: '2026-09-08T11:00:00.000Z',
    quizCount: 0,
    submissionCount: 1,
  },
];

let localMockAccounts: UserAccount[] = [...DEFAULT_MOCK_ACCOUNTS];

export const adminService = {
  async listTeacherApprovals(): Promise<TeacherApprovalRequest[]> {
    const result = await edge<{ requests: TeacherApprovalRow[] }>('manage-teacher-approvals', { action: 'list' }, 15_000);
    return result.requests.map(mapRequest);
  },
  approveTeacher: (firebaseUid: string) => edge('manage-teacher-approvals', { action: 'approve', firebaseUid }, 15_000),
  rejectTeacher: (firebaseUid: string) => edge('manage-teacher-approvals', { action: 'reject', firebaseUid }, 15_000),

  async listAccounts(role?: 'teacher' | 'student'): Promise<UserAccount[]> {
    try {
      const result = await edge<{ accounts: AccountRow[] }>(
        'manage-user-accounts',
        { action: 'list', role },
        15_000
      );
      if (result && Array.isArray(result.accounts)) {
        return result.accounts.map(mapAccount);
      }
    } catch {
      // Fallback for local development or when edge is mocked/unavailable
    }

    let accounts = [...localMockAccounts];
    if (role) {
      accounts = accounts.filter((acc) => acc.role === role);
    }
    return accounts;
  },

  async toggleBlockUser(userId: string, isBlocked: boolean): Promise<void> {
    try {
      await edge(
        'manage-user-accounts',
        { action: 'toggle_block', userId, isBlocked },
        15_000
      );
    } catch {
      // Fallback update
    }

    localMockAccounts = localMockAccounts.map((acc) =>
      acc.id === userId || acc.firebaseUid === userId
        ? { ...acc, isBlocked }
        : acc
    );
  },
};
