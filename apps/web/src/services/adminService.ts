import { edge } from '@/lib/cloud';
import type {
  AdminAccountDetail,
  AdminAccountSummary,
  ApprovalStatus,
  TeacherRequestStatus,
  UserRole,
} from '@qizzone/domain';

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

export interface AdminAccountSummaryRow {
  id?: string;
  firebase_uid?: string;
  email: string;
  full_name: string;
  role: UserRole;
  base_role?: UserRole;
  active_role?: UserRole;
  approval_status?: ApprovalStatus;
  teacher_request_status?: TeacherRequestStatus;
  teacher_request_blocked?: boolean;
  is_blocked?: boolean;
  avatar_url?: string | null;
  quiz_count?: number;
  classroom_count?: number;
  owned_classroom_count?: number;
  enrolled_classroom_count?: number;
  submission_count?: number;
  created_at: string;
}

function mapAccountSummary(row: AdminAccountSummaryRow): AdminAccountSummary {
  const uid = row.id || row.firebase_uid || '';
  const approvalStatus: ApprovalStatus = row.approval_status || 'approved';
  return {
    id: uid,
    firebaseUid: row.firebase_uid || uid,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    baseRole: row.base_role || row.role,
    activeRole: row.active_role || row.role,
    approvalStatus,
    teacherRequestStatus: row.teacher_request_status,
    teacherRequestBlocked: Boolean(row.teacher_request_blocked),
    isBlocked: row.is_blocked ?? approvalStatus === 'rejected',
    avatarUrl: row.avatar_url ?? null,
    quizCount: row.quiz_count ?? 0,
    classroomCount: row.classroom_count ?? 0,
    ownedClassroomCount: row.owned_classroom_count ?? 0,
    enrolledClassroomCount: row.enrolled_classroom_count ?? 0,
    submissionCount: row.submission_count ?? 0,
    createdAt: row.created_at,
  };
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

  async toggleBlockUser(userId: string, isBlocked: boolean, role?: 'teacher' | 'student' | 'admin'): Promise<void> {
    await edge(
      'manage-user-accounts',
      { action: 'toggle_block', userId, isBlocked, ...(role ? { role } : {}) },
      15_000,
    );
  },

  async listAccountSummaries(
    role?: 'teacher' | 'student' | 'admin' | 'all',
    includeAdmins?: boolean,
  ): Promise<AdminAccountSummary[]> {
    const result = await edge<{ accounts: AdminAccountSummaryRow[] }>(
      'manage-user-accounts',
      {
        action: 'list',
        ...(role ? { role } : {}),
        ...(includeAdmins !== undefined ? { includeAdmins } : {}),
      },
      15_000,
    );
    return Array.isArray(result?.accounts) ? result.accounts.map(mapAccountSummary) : [];
  },

  getAccountDetail: (userId: string): Promise<AdminAccountDetail> =>
    edge<AdminAccountDetail>(
      'manage-user-accounts',
      { action: 'detail', userId },
      15_000,
    ),

  changeUserRole: (userId: string, nextRole: 'student' | 'teacher' | 'admin') =>
    edge<{ profile: AdminAccountSummaryRow; active_role: UserRole | null }>(
      'manage-user-accounts',
      { action: 'change_role', userId, nextRole },
      15_000,
    ),

  reviewTeacherAccount: (userId: string, decision: 'approve' | 'reject') =>
    edge<{ profile: AdminAccountSummaryRow }>(
      'manage-user-accounts',
      { action: 'review_teacher', userId, decision },
      15_000,
    ),
};
