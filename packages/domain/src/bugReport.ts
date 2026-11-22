import { z } from "zod";

export const BUG_REPORT_STATUSES = ["new", "in_progress", "resolved"] as const;
export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number];

export const BUG_REPORT_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number];

export const BUG_REPORT_CATEGORIES = [
  "general",
  "exam",
  "classroom",
  "account",
  "notification",
  "ui",
  "performance",
] as const;
export type BugReportCategory = (typeof BUG_REPORT_CATEGORIES)[number];

export interface BugReport {
  id: string;
  reporterUid: string;
  reporterName?: string;
  reporterEmail?: string;
  reporterRole: "student" | "teacher" | "admin";
  title: string;
  description: string;
  category: string;
  severity: BugReportSeverity;
  pageRoute: string | null;
  contextMetadata: Record<string, unknown>;
  status: BugReportStatus;
  adminResponse: string | null;
  handledBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const createBugReportSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Tiêu đề báo lỗi cần ít nhất 3 ký tự")
    .max(200, "Tiêu đề báo lỗi tối đa 200 ký tự"),
  description: z
    .string()
    .trim()
    .min(10, "Mô tả chi tiết cần ít nhất 10 ký tự")
    .max(5000, "Mô tả chi tiết tối đa 5000 ký tự"),
  category: z.string().trim().min(1).max(60).default("general"),
  severity: z.enum(BUG_REPORT_SEVERITIES).default("medium"),
  pageRoute: z.string().trim().max(500).nullable().optional().default(null),
  contextMetadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type CreateBugReportInput = z.infer<typeof createBugReportSchema>;

export const updateBugReportStatusSchema = z.object({
  reportId: z.string().uuid(),
  status: z.enum(BUG_REPORT_STATUSES),
  adminResponse: z
    .string()
    .trim()
    .max(5000, "Phản hồi tối đa 5000 ký tự")
    .nullable()
    .optional(),
});

export type UpdateBugReportStatusInput = z.infer<
  typeof updateBugReportStatusSchema
>;

export const listBugReportsFilterSchema = z.object({
  status: z.enum(BUG_REPORT_STATUSES).nullable().optional(),
  role: z.enum(["student", "teacher", "admin"]).nullable().optional(),
});

export type ListBugReportsFilterInput = z.infer<
  typeof listBugReportsFilterSchema
>;
