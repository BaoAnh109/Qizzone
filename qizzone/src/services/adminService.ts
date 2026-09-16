import { edge } from '@/lib/cloud';

interface TeacherApprovalRow {
  firebase_uid: string;
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

function mapRequest(row: TeacherApprovalRow): TeacherApprovalRequest {
  return {
    firebaseUid: row.firebase_uid,
    email: row.email,
    fullName: row.full_name,
    status: row.role === 'student' && row.teacher_request_status !== 'pending' ? 'blocked' : 'pending',
    requestedAt: row.teacher_requested_at || row.approval_requested_at || row.created_at,
    blocked: Boolean(row.teacher_request_blocked),
    requestKind: row.role === 'student' ? 'teacher_access' : 'legacy_teacher',
  };
}

export const adminService = {
  async listTeacherApprovals(): Promise<TeacherApprovalRequest[]> {
    const result = await edge<{ requests: TeacherApprovalRow[] }>('manage-teacher-approvals', { action: 'list' }, 15_000);
    return result.requests.map(mapRequest);
  },
  approveTeacher: (firebaseUid: string) => edge('manage-teacher-approvals', { action: 'approve', firebaseUid }, 15_000),
  rejectTeacher: (firebaseUid: string) => edge('manage-teacher-approvals', { action: 'reject', firebaseUid }, 15_000),
  setTeacherRequestBlocked: (firebaseUid: string, blocked: boolean) => edge('manage-teacher-approvals', { action: 'set_blocked', firebaseUid, blocked }, 15_000),
};
