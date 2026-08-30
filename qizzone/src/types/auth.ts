export type UserRole = "teacher" | "student" | "admin";
export type Role = UserRole;

export interface User {
  id: string;
  email: string;
  fullName: string;
  name?: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
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

export interface AuthResponse {
  user: User;
  token: string;
  message?: string;
}