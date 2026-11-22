import { rpc } from "@/lib/cloud";
import {
  addClassroomMembersBulkSchema,
  assignQuizToClassroomsSchema,
  createClassroomSchema,
  joinClassroomByCodeSchema,
  updateClassroomSchema,
  type AddClassroomMembersBulkInput,
  type AssignQuizToClassroomsInput,
  type BulkAddClassroomMembersResult,
  type Classroom,
  type ClassroomAssignment,
  type ClassroomDetail,
  type CreateClassroomInput,
  type StudentAssignmentItem,
  type TeacherQuizTrackingResult,
  type UpdateClassroomInput,
} from "@qizzone/domain";

export const classroomService = {
  listMyClassrooms: () => rpc<Classroom[]>("list_my_classrooms"),

  getClassroomDetail: (classroomId: string) =>
    rpc<ClassroomDetail>("get_classroom_detail", {
      p_classroom_id: classroomId,
    }),

  createClassroom: (input: CreateClassroomInput) => {
    const parsed = createClassroomSchema.parse(input);
    return rpc<Classroom>("create_classroom", {
      p_name: parsed.name,
      p_subject: parsed.subject,
      p_grade_level: parsed.gradeLevel,
      p_description: parsed.description,
    });
  },

  updateClassroom: (classroomId: string, input: UpdateClassroomInput) => {
    const parsed = updateClassroomSchema.parse(input);
    return rpc<Classroom>("update_classroom", {
      p_id: classroomId,
      p_name: parsed.name ?? null,
      p_subject: parsed.subject ?? null,
      p_grade_level: parsed.gradeLevel ?? null,
      p_description: parsed.description ?? null,
      p_invite_enabled: parsed.inviteEnabled ?? null,
      p_is_archived: parsed.isArchived ?? null,
    });
  },

  regenerateInviteCode: (classroomId: string) =>
    rpc<string>("regenerate_classroom_code", {
      p_id: classroomId,
    }),

  addMembersBulk: (input: AddClassroomMembersBulkInput) => {
    const parsed = addClassroomMembersBulkSchema.parse(input);
    return rpc<BulkAddClassroomMembersResult>("add_classroom_members_bulk", {
      p_classroom_id: parsed.classroomId,
      p_emails: parsed.emails,
      p_joined_via: parsed.joinedVia,
    });
  },

  removeMember: (classroomId: string, memberId: string) =>
    rpc<void>("remove_classroom_member", {
      p_classroom_id: classroomId,
      p_member_id: memberId,
    }),

  joinByCode: (code: string, via: "code" | "link" = "code") => {
    const parsed = joinClassroomByCodeSchema.parse({ code, via });
    return rpc<Classroom>("join_classroom_by_code", {
      p_code: parsed.code.trim().toUpperCase(),
      p_via: parsed.via,
    });
  },

  assignQuizToClassrooms: (input: AssignQuizToClassroomsInput) => {
    const parsed = assignQuizToClassroomsSchema.parse(input);
    return rpc<ClassroomAssignment[]>("assign_quiz_to_classrooms", {
      p_quiz_id: parsed.quizId,
      p_assignments: parsed.assignments,
    });
  },

  listTeacherQuizTracking: (quizId: string, classroomId?: string | null) =>
    rpc<TeacherQuizTrackingResult>("list_teacher_quiz_tracking", {
      p_quiz_id: quizId,
      p_classroom_id: classroomId ?? null,
    }),

  listStudentAssignments: (classroomId?: string | null) =>
    rpc<StudentAssignmentItem[]>("list_student_assignments", {
      p_classroom_id: classroomId ?? null,
    }),
};
