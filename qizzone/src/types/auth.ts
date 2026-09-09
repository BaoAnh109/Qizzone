export type UserRole = "teacher" | "student" | "admin";
export type Role = UserRole;
export type ApprovalStatus = "approved" | "pending" | "rejected";

export interface User {
  id: string;
  email: string;
  fullName: string;
  name?: string;
  role: UserRole;
  approvalStatus: ApprovalStatus;
  avatarUrl?: string;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  fullName: string;
  email: string;
  password: string;
  confirmPassword?: string;
  role: UserRole;
}
