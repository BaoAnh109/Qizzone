import { edge } from '@/lib/cloud';

interface TeacherApprovalRow {
  id?: string;
  firebase_uid?: string;
  email: string;
  full_name: string;
  role: 'student' | 'teacher';
  approval_status: 'approved' | 'pending' | 'rejected';
  approval_requested_at: string | null;
  teacher_request_status?: 'none' | 'pending' | 'approved' | 'rejected' | null;
  teacher_request_blocked?: boolean | null;
  teacher_requested_at?: string | null;
  created_at: string;
}

export interface TeacherApprovalRequest {
  firebaseUid: string;
  email: string;
  fullName: string;
  status: 'pending' | 'blocked';
  requestedAt: string;
  blocked: boolean;
  requestKind: 'teacher_access' | 'legacy_teacher';
}

export interface AccountRow {
  id?: string;
  firebase_uid?: string;
  email: string;
  full_name: string;
  role: 'teacher' | 'student';
  approval_status?: string;
  is_blocked?: boolean;
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
  quizCount: number;
  submissionCount: number;
}

function mapRequest(row: TeacherApprovalRow): TeacherApprovalRequest {
  const uid = row.id || row.firebase_uid || '';
  return {
    firebaseUid: uid,
    email: row.email,
    fullName: row.full_name,
    status: row.role === 'student' && row.teacher_request_status !== 'pending' ? 'blocked' : 'pending',
    requestedAt: row.teacher_requested_at || row.approval_requested_at || row.created_at,
    blocked: Boolean(row.teacher_request_blocked),
    requestKind: row.role === 'student' ? 'teacher_access' : 'legacy_teacher',
  };
}

function mapAccount(row: AccountRow): UserAccount {
  const uid = row.id || row.firebase_uid || '';
  return {
    id: uid,
    firebaseUid: row.firebase_uid || uid,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isBlocked: row.is_blocked ?? (row.approval_status === 'rejected' || row.approval_status === 'blocked'),
    createdAt: row.created_at,
    quizCount: row.quiz_count ?? 0,
    submissionCount: row.submission_count ?? 0,
  };
}

let inFlightApprovals: Promise<TeacherApprovalRequest[]> | null = null;
const inFlightAccounts = new Map<string, Promise<UserAccount[]>>();

export const adminService = {
  listTeacherApprovals(): Promise<TeacherApprovalRequest[]> {
    if (inFlightApprovals) return inFlightApprovals;
    inFlightApprovals = edge<{ requests: TeacherApprovalRow[] }>('manage-teacher-approvals', { action: 'list' }, 15_000)
      .then(result => result.requests.map(mapRequest))
      .finally(() => {
        inFlightApprovals = null;
      });
    return inFlightApprovals;
  },
  approveTeacher: (targetUid: string) =>
    edge('manage-teacher-approvals', { action: 'approve', firebaseUid: targetUid }, 15_000),
  rejectTeacher: (targetUid: string) =>
    edge('manage-teacher-approvals', { action: 'reject', firebaseUid: targetUid }, 15_000),
  setTeacherRequestBlocked: (targetUid: string, blocked: boolean) =>
    edge('manage-teacher-approvals', { action: 'set_blocked', firebaseUid: targetUid, blocked }, 15_000),

  listAccounts(role?: 'teacher' | 'student'): Promise<UserAccount[]> {
    const cacheKey = role || 'all';
    const existing = inFlightAccounts.get(cacheKey);
    if (existing) return existing;
    const promise = edge<{ accounts: AccountRow[] }>(
      'manage-user-accounts',
      { action: 'list', role },
      15_000,
    )
      .then(result => (Array.isArray(result?.accounts) ? result.accounts.map(mapAccount) : []))
      .finally(() => {
        inFlightAccounts.delete(cacheKey);
      });
    inFlightAccounts.set(cacheKey, promise);
    return promise;
  },

  async toggleBlockUser(userId: string, isBlocked: boolean, role?: 'teacher' | 'student'): Promise<void> {
    await edge(
      'manage-user-accounts',
      { action: 'toggle_block', userId, isBlocked, ...(role ? { role } : {}) },
      15_000,
    );
  },
};
