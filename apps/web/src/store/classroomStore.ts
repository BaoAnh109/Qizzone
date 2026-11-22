import { create } from "zustand";
import { errorMessage } from "@/lib/cloud";
import { classroomService } from "@/services/classroomService";
import type {
  AddClassroomMembersBulkInput,
  AssignQuizToClassroomsInput,
  BulkAddClassroomMembersResult,
  Classroom,
  ClassroomAssignment,
  ClassroomDetail,
  CreateClassroomInput,
  StudentAssignmentItem,
  UpdateClassroomInput,
} from "@qizzone/domain";

let loadVersion = 0;
let inFlightLoad: Promise<void> | null = null;

interface ClassroomStoreState {
  classrooms: Classroom[];
  classroomDetails: Record<string, ClassroomDetail>;
  studentAssignments: StudentAssignmentItem[];
  isLoading: boolean;
  error: string | null;
  reset: () => void;
  load: () => Promise<void>;
  loadClassrooms: () => Promise<void>;
  loadClassroomDetail: (classroomId: string) => Promise<ClassroomDetail>;
  loadStudentAssignments: (classroomId?: string | null) => Promise<StudentAssignmentItem[]>;
  createClassroom: (input: CreateClassroomInput) => Promise<Classroom>;
  updateClassroom: (classroomId: string, input: UpdateClassroomInput) => Promise<Classroom>;
  regenerateCode: (classroomId: string) => Promise<string>;
  addMembersBulk: (input: AddClassroomMembersBulkInput) => Promise<BulkAddClassroomMembersResult>;
  removeMember: (classroomId: string, memberId: string) => Promise<void>;
  joinByCode: (code: string, via?: "code" | "link") => Promise<Classroom>;
  assignQuizToClassrooms: (input: AssignQuizToClassroomsInput) => Promise<ClassroomAssignment[]>;
}

export const useClassroomStore = create<ClassroomStoreState>((set, get) => ({
  classrooms: [],
  classroomDetails: {},
  studentAssignments: [],
  isLoading: false,
  error: null,

  reset: () => {
    loadVersion += 1;
    inFlightLoad = null;
    set({
      classrooms: [],
      classroomDetails: {},
      studentAssignments: [],
      isLoading: false,
      error: null,
    });
  },

  load: () => get().loadClassrooms(),

  loadClassrooms: async () => {
    if (inFlightLoad) return inFlightLoad;
    const version = loadVersion;
    set({ isLoading: true, error: null });
    inFlightLoad = (async () => {
      try {
        const classrooms = await classroomService.listMyClassrooms();
        if (version === loadVersion) {
          set({ classrooms, error: null });
        }
      } catch (error) {
        if (version === loadVersion) {
          set({ error: errorMessage(error) });
        }
        throw error;
      } finally {
        if (version === loadVersion) {
          set({ isLoading: false });
        }
        inFlightLoad = null;
      }
    })();
    return inFlightLoad;
  },

  loadClassroomDetail: async (classroomId) => {
    const detail = await classroomService.getClassroomDetail(classroomId);
    set((state) => ({
      classroomDetails: {
        ...state.classroomDetails,
        [classroomId]: detail,
      },
      classrooms: state.classrooms.some((c) => c.id === detail.classroom.id)
        ? state.classrooms.map((c) => (c.id === detail.classroom.id ? detail.classroom : c))
        : state.classrooms,
    }));
    return detail;
  },

  loadStudentAssignments: async (classroomId) => {
    const items = await classroomService.listStudentAssignments(classroomId);
    if (!classroomId) {
      set({ studentAssignments: items });
    }
    return items;
  },

  createClassroom: async (input) => {
    const created = await classroomService.createClassroom(input);
    set((state) => ({
      classrooms: [created, ...state.classrooms.filter((c) => c.id !== created.id)],
    }));
    return created;
  },

  updateClassroom: async (classroomId, input) => {
    const updated = await classroomService.updateClassroom(classroomId, input);
    set((state) => {
      const existingDetail = state.classroomDetails[classroomId];
      return {
        classrooms: state.classrooms.map((c) => (c.id === updated.id ? updated : c)),
        classroomDetails: existingDetail
          ? {
              ...state.classroomDetails,
              [classroomId]: {
                ...existingDetail,
                classroom: updated,
              },
            }
          : state.classroomDetails,
      };
    });
    return updated;
  },

  regenerateCode: async (classroomId) => {
    const newCode = await classroomService.regenerateInviteCode(classroomId);
    set((state) => {
      const existingDetail = state.classroomDetails[classroomId];
      return {
        classrooms: state.classrooms.map((c) =>
          c.id === classroomId ? { ...c, inviteCode: newCode } : c
        ),
        classroomDetails: existingDetail
          ? {
              ...state.classroomDetails,
              [classroomId]: {
                ...existingDetail,
                classroom: { ...existingDetail.classroom, inviteCode: newCode },
              },
            }
          : state.classroomDetails,
      };
    });
    return newCode;
  },

  addMembersBulk: async (input) => {
    const result = await classroomService.addMembersBulk(input);
    await get().loadClassroomDetail(input.classroomId);
    return result;
  },

  removeMember: async (classroomId, memberId) => {
    await classroomService.removeMember(classroomId, memberId);
    await get().loadClassroomDetail(classroomId);
  },

  joinByCode: async (code, via = "code") => {
    const joined = await classroomService.joinByCode(code, via);
    set((state) => ({
      classrooms: [joined, ...state.classrooms.filter((c) => c.id !== joined.id)],
    }));
    return joined;
  },

  assignQuizToClassrooms: async (input) => {
    const assignments = await classroomService.assignQuizToClassrooms(input);
    await get().loadClassrooms().catch(() => undefined);
    return assignments;
  },
}));

export default useClassroomStore;
