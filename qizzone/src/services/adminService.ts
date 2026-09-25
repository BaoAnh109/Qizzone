import { edge, supabase } from '@/lib/cloud';

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

export interface AccountRow {
  id?: string;
  firebase_uid: string;
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

function mapAccount(row: AccountRow): UserAccount {
  return {
    id: row.id || row.firebase_uid,
    firebaseUid: row.firebase_uid,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isBlocked: row.is_blocked ?? (row.approval_status === 'rejected' || row.approval_status === 'blocked'),
    createdAt: row.created_at,
    quizCount: row.quiz_count ?? 0,
    submissionCount: row.submission_count ?? 0,
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

  async listAccounts(role?: 'teacher' | 'student'): Promise<UserAccount[]> {
    // 1. Try edge function manage-user-accounts if deployed or mocked in tests
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
      // In live application, edge manage-user-accounts may not be present,
      // fallback to querying real profiles table directly from database
    }

    // 2. Fetch real user accounts from Supabase profiles table
    try {
      const client = supabase();
      let query = client
        .from('profiles')
        .select('firebase_uid, email, full_name, role, approval_status, created_at')
        .order('created_at', { ascending: false });

      if (role) {
        query = query.eq('role', role);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        return data
          .filter((row: AccountRow) => row.role === 'teacher' || row.role === 'student')
          .map(mapAccount);
      }
    } catch (err) {
      console.warn('Cannot fetch real profiles from database:', err);
    }

    return [];
  },

  async toggleBlockUser(userId: string, isBlocked: boolean, role?: 'teacher' | 'student'): Promise<void> {
    // 1. Try edge function manage-user-accounts first (tested & supported)
    try {
      await edge(
        'manage-user-accounts',
        { action: 'toggle_block', userId, isBlocked },
        15_000
      );
      return;
    } catch {
      // Edge function manage-user-accounts not available, handle with real teacher approval or db update
    }

    // 2. If target is a teacher, use the live manage-teacher-approvals edge function
    if (role === 'teacher') {
      try {
        if (isBlocked) {
          await adminService.rejectTeacher(userId);
          return;
        } else {
          await adminService.approveTeacher(userId);
          return;
        }
      } catch (err) {
        console.warn('Teacher approval action failed:', err);
      }
    }

    // 3. Update real user profile in database
    try {
      const now = new Date().toISOString();
      const nextStatus = isBlocked ? 'rejected' : 'approved';
      const client = supabase();
      const profileTable = client.from('profiles') as unknown as {
        update: (data: Record<string, unknown>) => { eq: (col: string, val: unknown) => Promise<unknown> };
      };
      await profileTable
        .update({
          approval_status: nextStatus,
          reviewed_at: now,
          updated_at: now,
        })
        .eq('firebase_uid', userId);
    } catch (err) {
      console.warn('Direct database profile update failed:', err);
    }
  },
};
