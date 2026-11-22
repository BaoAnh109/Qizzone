import { z } from "zod";

export const CLASSROOM_MEMBER_STATUSES = [
  "pending_invite",
  "active",
  "removed",
] as const;
export type ClassroomMemberStatus = (typeof CLASSROOM_MEMBER_STATUSES)[number];

export const CLASSROOM_JOIN_VIAS = [
  "code",
  "link",
  "teacher_email",
  "excel_import",
] as const;
export type ClassroomJoinVia = (typeof CLASSROOM_JOIN_VIAS)[number];

export const LATE_POLICIES = ["block_after_due", "allow_late"] as const;
export type LatePolicy = (typeof LATE_POLICIES)[number];

export const STUDENT_ASSIGNMENT_STATUSES = [
  "todo",
  "completed",
  "overdue",
] as const;
export type StudentAssignmentStatus =
  (typeof STUDENT_ASSIGNMENT_STATUSES)[number];

export type TeacherQuizTrackingStatus =
  | "submitted_on_time"
  | "submitted_late"
  | "in_progress"
  | "not_submitted";

export interface Classroom {
  id: string;
  teacherUid: string;
  teacherName?: string;
  name: string;
  subject: string;
  gradeLevel: string;
  description: string;
  inviteCode: string;
  inviteEnabled: boolean;
  isArchived: boolean;
  memberCount: number;
  assignmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomMember {
  id: string;
  classroomId: string;
  studentUid: string | null;
  invitedEmail: string;
  memberName: string;
  status: ClassroomMemberStatus;
  joinedVia: ClassroomJoinVia;
  joinedAt: string | null;
  createdAt: string;
}

export interface ClassroomAssignment {
  id: string;
  classroomId: string;
  classroomName?: string;
  quizId: string;
  quizTitle?: string;
  quizCode?: string;
  assignedBy: string | null;
  title: string | null;
  instructions: string;
  availableFrom: string | null;
  dueAt: string | null;
  latePolicy: LatePolicy;
  hardCloseAt: string | null;
  maxAttemptsOverride: number | null;
  createdAt: string;
}

export interface ClassroomDetail {
  classroom: Classroom;
  members: ClassroomMember[];
  assignments: ClassroomAssignment[];
}

export interface BulkAddClassroomMembersResult {
  addedActive: number;
  addedPending: number;
  skippedExisting: number;
  invalidEmails: string[];
}

export interface StudentAssignmentItem {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  quizId: string;
  quizTitle: string;
  quizCode: string;
  subject: string;
  title: string | null;
  instructions: string;
  availableFrom: string | null;
  dueAt: string | null;
  latePolicy: LatePolicy;
  hardCloseAt: string | null;
  maxAttempts: number;
  attemptCount: number;
  hasActiveAttempt: boolean;
  status: StudentAssignmentStatus;
  isLate: boolean;
  bestScore: number | null;
  scoreHidden?: boolean;
  latestResultId: string | null;
  latestSubmittedAt: string | null;
}

export interface TeacherQuizTrackingSummary {
  total: number;
  submittedOnTime: number;
  submittedLate: number;
  inProgress: number;
  notSubmitted: number;
}

export interface TeacherQuizTrackingRow {
  studentUid: string | null;
  invitedEmail: string;
  studentName: string;
  classroomId: string | null;
  classroomName: string | null;
  status: TeacherQuizTrackingStatus;
  attemptCount: number;
  score: number | null;
  percentage: number | null;
  isLate: boolean;
  lateSeconds: number;
  submittedAt: string | null;
  latestResultId: string | null;
}

export interface TeacherQuizTrackingResult {
  summary: TeacherQuizTrackingSummary;
  rows: TeacherQuizTrackingRow[];
}

export const createClassroomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập tên lớp học")
    .max(120, "Tên lớp tối đa 120 ký tự"),
  subject: z.string().trim().max(100, "Môn học tối đa 100 ký tự").default(""),
  gradeLevel: z.string().trim().max(50, "Khối lớp tối đa 50 ký tự").default(""),
  description: z
    .string()
    .trim()
    .max(2000, "Mô tả lớp tối đa 2000 ký tự")
    .default(""),
});

export type CreateClassroomInput = z.infer<typeof createClassroomSchema>;

export const updateClassroomSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().max(100).optional(),
  gradeLevel: z.string().trim().max(50).optional(),
  description: z.string().trim().max(2000).optional(),
  inviteEnabled: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export type UpdateClassroomInput = z.infer<typeof updateClassroomSchema>;

export const joinClassroomByCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Mã lớp không hợp lệ")
    .max(20, "Mã lớp không hợp lệ"),
  via: z.enum(["code", "link"]).default("code"),
});

export type JoinClassroomByCodeInput = z.infer<typeof joinClassroomByCodeSchema>;

export const addClassroomMembersBulkSchema = z.object({
  classroomId: z.string().uuid(),
  emails: z
    .array(z.string().trim().email("Địa chỉ email không hợp lệ"))
    .min(1, "Vui lòng nhập ít nhất 1 email học sinh")
    .max(500, "Tối đa 500 email mỗi lần thêm"),
  joinedVia: z.enum(["teacher_email", "excel_import"]).default("teacher_email"),
});

export type AddClassroomMembersBulkInput = z.infer<
  typeof addClassroomMembersBulkSchema
>;

export const classroomAssignmentItemInputSchema = z
  .object({
    classroomId: z.string().uuid(),
    title: z.string().trim().max(200).nullable().optional(),
    instructions: z.string().trim().max(4000).default(""),
    availableFrom: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    latePolicy: z.enum(LATE_POLICIES).default("allow_late"),
    hardCloseAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    maxAttemptsOverride: z.number().int().min(0).max(100).nullable().optional(),
  })
  .refine(
    (data) => {
      if (!data.availableFrom || !data.dueAt) return true;
      return new Date(data.dueAt).getTime() >= new Date(data.availableFrom).getTime();
    },
    {
      message: "Hạn nộp phải sau hoặc bằng thời gian mở bài",
      path: ["dueAt"],
    },
  )
  .refine(
    (data) => {
      if (!data.dueAt || !data.hardCloseAt) return true;
      return new Date(data.hardCloseAt).getTime() >= new Date(data.dueAt).getTime();
    },
    {
      message: "Thời gian đóng hẳn phải sau hoặc bằng hạn nộp",
      path: ["hardCloseAt"],
    },
  )
  .refine(
    (data) => {
      if (!data.availableFrom || !data.hardCloseAt) return true;
      return new Date(data.hardCloseAt).getTime() >= new Date(data.availableFrom).getTime();
    },
    {
      message: "Thời gian đóng hẳn phải sau hoặc bằng thời gian mở bài",
      path: ["hardCloseAt"],
    },
  );

export const assignQuizToClassroomsSchema = z.object({
  quizId: z.string().uuid(),
  assignments: z
    .array(classroomAssignmentItemInputSchema)
    .min(1, "Vui lòng chọn ít nhất 1 lớp học")
    .max(100),
});

export type AssignQuizToClassroomsInput = z.infer<
  typeof assignQuizToClassroomsSchema
>;
