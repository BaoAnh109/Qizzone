import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  edge: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/cloud', () => ({
  edge: mocks.edge,
  rpc: mocks.rpc,
}));

import { examSessionService } from '@/services/examSessionService';

describe('V3 Edge Contracts & Notification / R2 Security Boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls finalize-exam edge function with attemptId and idempotencyKey', async () => {
    mocks.edge.mockResolvedValue({ score: 9.5, status: 'submitted', result: { id: 'res-1' } });
    const res = await examSessionService.finalizeExam(
      '550e8400-e29b-41d4-a716-446655440000',
      'idem-submit-123456',
    );
    expect(res.score).toBe(9.5);
    expect(mocks.edge).toHaveBeenCalledWith(
      'finalize-exam',
      {
        attemptId: '550e8400-e29b-41d4-a716-446655440000',
        idempotencyKey: 'idem-submit-123456',
      },
      20_000,
    );
  });

  it('enforces user-scoped objectKey, 50 MiB cap, and short presigned TTL in R2 Edge Functions', () => {
    const createUrlSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/create-upload-url/index.ts', import.meta.url)),
      'utf8',
    );
    const confirmUrlSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/confirm-upload/index.ts', import.meta.url)),
      'utf8',
    );
    const r2Source = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/_shared/r2.ts', import.meta.url)),
      'utf8',
    );

    expect(createUrlSource).toContain('await identity(req)');
    expect(createUrlSource).toContain("requireProfileAndRole(db, auth, ['teacher', 'admin'])");
    expect(createUrlSource).toContain('materials/${auth.uid}/${materialId}');
    expect(createUrlSource).toContain('50 * 1024 * 1024');
    expect(confirmUrlSource).toContain('await headR2Object(material.object_key)');
    expect(confirmUrlSource).toContain('material.owner_uid !== auth.uid');
    expect(r2Source).toContain('Math.min(300, Math.max(60');
  });

  it('enforces Asia/Ho_Chi_Minh daily limit, HTTPS Brevo API v3, atomic claim, and cron/admin gate in dispatch-email', () => {
    const dispatchSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/dispatch-email/index.ts', import.meta.url)),
      'utf8',
    );
    expect(dispatchSource).toContain("Asia/Ho_Chi_Minh");
    expect(dispatchSource).toContain('https://api.brevo.com/v3/smtp/email');
    expect(dispatchSource).toContain("'api-key': brevoApiKey!");
    expect(dispatchSource).toContain("'X-Qizzone-Idempotency-Key': item.idempotency_key");
    expect(dispatchSource).toContain("BREVO_DAILY_LIMIT");
    expect(dispatchSource).toContain("provider: 'brevo'");
    expect(dispatchSource).toContain("status: 'processing'");
    expect(dispatchSource).toContain("dead_letter");
    expect(dispatchSource).toContain("notification_delivery_logs");
    expect(dispatchSource).toContain('isInternalCron');
  });

  it('deletes temporary Gemini uploaded files after extraction and supports Files API', () => {
    const extractSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/_shared/extractHandler.ts', import.meta.url)),
      'utf8',
    );
    expect(extractSource).toContain('https://generativelanguage.googleapis.com/upload/v1beta/files');
    expect(extractSource).toContain('deleteGeminiFileQuietly');
    expect(extractSource).toContain('consume_ai_quota_v3');
    expect(extractSource).toContain('ai_extraction_jobs');
  });

  it('enforces old password, Google-only block, 15m Brevo OTP, and server password update in change-password', () => {
    const changePasswordSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/change-password/index.ts', import.meta.url)),
      'utf8',
    );
    expect(changePasswordSource).toContain('GOOGLE_ONLY_ACCOUNT');
    expect(changePasswordSource).toContain('INVALID_CURRENT_PASSWORD');
    expect(changePasswordSource).toContain('OTP_TTL_SECONDS = 900');
    expect(changePasswordSource).toContain('create_password_change_otp_v3');
    expect(changePasswordSource).toContain('verify_password_change_otp_v3');
    expect(changePasswordSource).toContain('https://api.brevo.com/v3/smtp/email');
    expect(changePasswordSource).toContain('updateUserById');
  });

  it('enforces admin self/last-admin guards, dual-role counts, and pending invite activation in M1 Edge Functions', () => {
    const manageAccountsSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/manage-user-accounts/index.ts', import.meta.url)),
      'utf8',
    );
    const bootstrapSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/bootstrap-profile/index.ts', import.meta.url)),
      'utf8',
    );
    const teacherApprovalsSource = readFileSync(
      fileURLToPath(new URL('../../../../../supabase/functions/manage-teacher-approvals/index.ts', import.meta.url)),
      'utf8',
    );

    const authIdx = manageAccountsSource.indexOf('await identity(req)');
    const adminIdx = manageAccountsSource.indexOf("requireProfileAndRole(db, auth, ['admin'])");
    expect(authIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeGreaterThan(authIdx);
    expect(manageAccountsSource).toContain('CANNOT_MODIFY_SELF');
    expect(manageAccountsSource).toContain('LAST_ADMIN_PROTECTED');
    expect(manageAccountsSource).toContain("body.action === 'detail'");
    expect(manageAccountsSource).toContain("body.action === 'change_role'");
    expect(manageAccountsSource).toContain("body.action === 'review_teacher'");
    expect(manageAccountsSource).toContain('teacher_request_status.eq.approved');
    expect(manageAccountsSource).toContain('UUID_REGEX.test');
    expect(manageAccountsSource).toContain("select('active_role')");
    expect(manageAccountsSource).toContain('if (userRoleErr) throw userRoleErr');
    expect(manageAccountsSource).toContain('if (updateAuthErr) throw updateAuthErr');
    expect(manageAccountsSource).toContain('teacher_request_blocked: false');
    expect(manageAccountsSource).toContain('blocked: false');
    expect(manageAccountsSource).toContain('runSideEffect');

    expect(bootstrapSource).toContain("select('active_role')");
    expect(bootstrapSource).toContain("if (role === 'student')");
    expect(bootstrapSource).toContain('email_confirmed_at');
    expect(bootstrapSource).toContain('requireRemoteUser: true');
    expect(bootstrapSource).toContain("eq('status', 'pending_invite')");
    expect(bootstrapSource).toContain('classroom_joined');
    expect(bootstrapSource).toContain('/student/classes/');

    expect(teacherApprovalsSource).toContain('in_app_notifications');
    expect(teacherApprovalsSource).toContain('runSideEffect');
    expect(teacherApprovalsSource).toContain('teacher_request_blocked: false');
    expect(teacherApprovalsSource).toContain('blocked: false');
    expect(teacherApprovalsSource).not.toContain('body.role');
  });
});
