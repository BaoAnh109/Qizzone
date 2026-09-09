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

function mapRequest(row: TeacherApprovalRow): TeacherApprovalRequest {
  return {
    firebaseUid: row.firebase_uid,
    email: row.email,
    fullName: row.full_name,
    status: row.approval_status,
    requestedAt: row.approval_requested_at || row.created_at,
  };
}

export const adminService = {
  async listTeacherApprovals(): Promise<TeacherApprovalRequest[]> {
    const result = await edge<{ requests: TeacherApprovalRow[] }>('manage-teacher-approvals', { action: 'list' }, 15_000);
    return result.requests.map(mapRequest);
  },
  approveTeacher: (firebaseUid: string) => edge('manage-teacher-approvals', { action: 'approve', firebaseUid }, 15_000),
  rejectTeacher: (firebaseUid: string) => edge('manage-teacher-approvals', { action: 'reject', firebaseUid }, 15_000),
};
