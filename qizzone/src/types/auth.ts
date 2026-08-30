export type Role = "teacher" | "student" | "admin";
export type UserRole = Role;

export interface User {
  id: string;
  name?: string;
  fullName?: string;
  email: string;
  role: Role;
  avatarUrl?: string;
  createdAt?: string;
}

export interface AuthState {
  user: User | null;
  token?: string | null;
  isAuthenticated: boolean;
  isLoading?: boolean;
}