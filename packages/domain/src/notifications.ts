import { z } from "zod";

export const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";
export const DEFAULT_DAILY_EMAIL_LIMIT = 100;

export const NOTIFICATION_EVENT_TYPES = [
  "teacher_approval",
  "quiz_assigned",
  "schedule_changed",
  "exam_reminder_24h",
  "exam_reminder_1h",
  "exam_result",
  "system_notice",
  "security_alert",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export interface NotificationPreferences {
  userId: string;
  teacherApprovalEmail: boolean;
  quizAssignedEmail: boolean;
  examReminderEmail: boolean;
  examResultEmail: boolean;
  systemEmail: boolean;
  updatedAt?: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferences, "userId"> = {
  teacherApprovalEmail: true,
  quizAssignedEmail: true,
  examReminderEmail: true,
  examResultEmail: true,
  systemEmail: true,
};

export type NotificationOutboxStatus = "pending" | "processing" | "sent" | "retry" | "dead_letter" | "skipped";

export interface NotificationOutboxItem {
  id: string;
  recipientUid: string;
  recipientEmail: string;
  eventType: NotificationEventType;
  templateCode: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  scheduledAt: string;
  status: NotificationOutboxStatus;
  attemptCount: number;
  nextAttemptAt?: string | null;
  providerMessageId?: string | null;
  lastError?: string | null;
}

export const updateNotificationPreferencesSchema = z.object({
  teacherApprovalEmail: z.boolean().optional(),
  quizAssignedEmail: z.boolean().optional(),
  examReminderEmail: z.boolean().optional(),
  examResultEmail: z.boolean().optional(),
  systemEmail: z.boolean().optional(),
});

/** Computes exponential backoff in seconds (capped at 1 hour). */
export function computeNotificationRetryDelaySeconds(attemptCount: number): number {
  const safeAttempt = Math.max(1, attemptCount);
  return Math.min(3600, 30 * Math.pow(2, safeAttempt - 1));
}

/** Formats an instant in Vietnam time (`Asia/Ho_Chi_Minh`) for deterministic email scheduling/display. */
export function formatVietnamDateTime(isoTimestamp: string | Date): string {
  const date = typeof isoTimestamp === "string" ? new Date(isoTimestamp) : isoTimestamp;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export const IN_APP_NOTIFICATION_TYPES = [
  "teacher_approval",
  "role_changed",
  "account_status",
  "classroom_joined",
  "quiz_assigned",
  "bug_report_created",
  "bug_report_updated",
  "system_notice",
] as const;

export type InAppNotificationType = (typeof IN_APP_NOTIFICATION_TYPES)[number];

export interface InAppNotification {
  id: string;
  recipientUid: string;
  actorUid: string | null;
  type: InAppNotificationType | string;
  title: string;
  body: string;
  targetRoute: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export const inAppNotificationSchema = z.object({
  id: z.string().uuid(),
  recipientUid: z.string().min(1),
  actorUid: z.string().nullable().optional().default(null),
  type: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  targetRoute: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).default({}),
  isRead: z.boolean(),
  readAt: z.string().nullable().optional().default(null),
  createdAt: z.string(),
});

export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(200).nullable().optional().default(null),
});

export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
