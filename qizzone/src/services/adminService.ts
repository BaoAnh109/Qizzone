import { edge, isQizzoneApiConfigured, qizzoneApi, supabase } from '@/lib/cloud';

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

export interface TeacherApprovalListPage {
  requests: TeacherApprovalRequest[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
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

export type AccountStatusFilter = 'all' | 'active' | 'blocked';

export interface AccountListQuery {
  role?: 'teacher' | 'student';
  status?: AccountStatusFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AccountListPage {
  accounts: UserAccount[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  teacherCount: number;
  studentCount: number;
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

function mapApiAccount(row: {
  firebaseUid: string;
  email: string;
  fullName: string;
  role: 'student' | 'teacher';
  approvalStatus: string;
  createdAt: string;
  quizCount: number;
  submissionCount: number;
}): UserAccount {
  return mapAccount({
    id: row.firebaseUid,
    firebase_uid: row.firebaseUid,
    email: row.email,
    full_name: row.fullName,
    role: row.role,
    approval_status: row.approvalStatus,
    is_blocked: row.approvalStatus === 'rejected' || row.approvalStatus === 'blocked',
    created_at: row.createdAt,
    quiz_count: row.quizCount,
    submission_count: row.submissionCount,
  });
}

export const adminService = {
  async listTeacherApprovals(page = 1, pageSize = 25): Promise<TeacherApprovalListPage> {
    if (isQizzoneApiConfigured) {
      const result = await qizzoneApi<{ requests: Array<{
        firebaseUid: string;
        email: string;
        fullName: string;
        role: 'student' | 'teacher';
        approvalStatus: string;
        teacherRequestStatus: string;
        teacherRequestBlocked: boolean;
        requestedAt: string | null;
        createdAt: string;
      }>; page: number; pageSize: number; totalItems: number; totalPages: number }>(
        `/api/v1/admin/teacher-requests?page=${page}&pageSize=${pageSize}`,
      );
      return {
        requests: result.requests.map(row => ({
          firebaseUid: row.firebaseUid,
          email: row.email,
          fullName: row.fullName,
          status: row.role === 'student' && row.teacherRequestStatus !== 'pending' ? 'blocked' : 'pending',
          requestedAt: row.requestedAt || row.createdAt,
          blocked: row.teacherRequestBlocked,
          requestKind: row.role === 'student' ? 'teacher_access' : 'legacy_teacher',
        })),
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
      };
    }
    const result = await edge<{ requests: TeacherApprovalRow[] }>('manage-teacher-approvals', { action: 'list' }, 15_000);
    const requests = result.requests.map(mapRequest);
    const start = Math.max(0, (page - 1) * pageSize);
    return {
      requests: requests.slice(start, start + pageSize),
      page,
      pageSize,
      totalItems: requests.length,
      totalPages: Math.ceil(requests.length / pageSize),
    };
  },
  approveTeacher: (firebaseUid: string) => isQizzoneApiConfigured
    ? qizzoneApi(`/api/v1/admin/teacher-requests/${firebaseUid}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) })
    : edge('manage-teacher-approvals', { action: 'approve', firebaseUid }, 15_000),
  rejectTeacher: (firebaseUid: string) => isQizzoneApiConfigured
    ? qizzoneApi(`/api/v1/admin/teacher-requests/${firebaseUid}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject' }) })
    : edge('manage-teacher-approvals', { action: 'reject', firebaseUid }, 15_000),
  setTeacherRequestBlocked: (firebaseUid: string, blocked: boolean) => isQizzoneApiConfigured
    ? qizzoneApi(`/api/v1/admin/teacher-requests/${firebaseUid}`, { method: 'PATCH', body: JSON.stringify({ action: 'set_blocked', blocked }) })
    : edge('manage-teacher-approvals', { action: 'set_blocked', firebaseUid, blocked }, 15_000),

  async listAccounts(role?: 'teacher' | 'student'): Promise<UserAccount[]> {
    if (isQizzoneApiConfigured) {
      const accounts: UserAccount[] = [];
      for (let page = 1; page <= 10_000; page += 1) {
        const result = await adminService.listAccountsPage({ role, page, pageSize: 100 });
        accounts.push(...result.accounts);
        if (result.totalPages === 0 || page >= result.totalPages) break;
      }
      return accounts;
    }
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

  async listAccountsPage(query: AccountListQuery = {}): Promise<AccountListPage> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 25)));
    const search = query.search?.trim() ?? '';
    const status = query.status ?? 'all';

    if (isQizzoneApiConfigured) {
      const params = new URLSearchParams();
      if (query.role) params.set('role', query.role);
      if (status !== 'all') params.set('status', status);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const result = await qizzoneApi<{
        accounts: Array<{
          firebaseUid: string;
          email: string;
          fullName: string;
          role: 'student' | 'teacher';
          approvalStatus: string;
          createdAt: string;
          quizCount: number;
          submissionCount: number;
        }>;
        page?: number;
        pageSize?: number;
        totalItems?: number;
        totalPages?: number;
        teacherCount?: number;
        studentCount?: number;
      }>(`/api/v1/admin/accounts?${params.toString()}`);
      return {
        accounts: result.accounts.map(mapApiAccount),
        page: result.page ?? page,
        pageSize: result.pageSize ?? pageSize,
        totalItems: result.totalItems ?? result.accounts.length,
        totalPages: result.totalPages ?? (result.accounts.length > 0 ? 1 : 0),
        teacherCount: result.teacherCount ?? 0,
        studentCount: result.studentCount ?? 0,
      };
    }

    const allAccounts = await adminService.listAccounts();
    const normalizedSearch = search.toLocaleLowerCase();
    const filtered = allAccounts.filter(account => {
      if (query.role && account.role !== query.role) return false;
      if (status === 'blocked' && !account.isBlocked) return false;
      if (status === 'active' && account.isBlocked) return false;
      return !normalizedSearch ||
        account.fullName.toLocaleLowerCase().includes(normalizedSearch) ||
        account.email.toLocaleLowerCase().includes(normalizedSearch);
    });
    const totalItems = filtered.length;
    return {
      accounts: filtered.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      teacherCount: allAccounts.filter(account => account.role === 'teacher').length,
      studentCount: allAccounts.filter(account => account.role === 'student').length,
    };
  },

  async toggleBlockUser(userId: string, isBlocked: boolean, role?: 'teacher' | 'student'): Promise<void> {
    if (isQizzoneApiConfigured) {
      await qizzoneApi(`/api/v1/admin/accounts/${userId}/access`, {
        method: 'PATCH',
        body: JSON.stringify({ isBlocked }),
      });
      return;
    }
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
