import { z } from "zod";

export type UserRole = "teacher" | "student" | "admin";
export type Role = UserRole;
export type ApprovalStatus = "approved" | "pending" | "rejected";
export type TeacherRequestStatus = "none" | "pending" | "approved" | "rejected";

export interface User {
  id: string;
  email: string;
  emailVerified?: boolean;
  fullName: string;
  name?: string;
  role: UserRole;
  baseRole?: UserRole;
  approvalStatus: ApprovalStatus;
  teacherRequestStatus?: TeacherRequestStatus;
  teacherRequestBlocked?: boolean;
  teacherRequestedAt?: string;
  avatarUrl?: string;
  studentClass?: string;
  authProviders?: string[];
  hasPassword?: boolean;
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

export interface OtpVerifyPayload {
  email: string;
  token: string;
  type: "email" | "signup" | "recovery";
}

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Vui lòng nhập địa chỉ email")
    .email("Địa chỉ email không đúng định dạng"),
  password: z
    .string()
    .min(1, "Vui lòng nhập mật khẩu")
    .min(6, "Mật khẩu phải chứa ít nhất 6 ký tự"),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .min(1, "Vui lòng nhập họ và tên")
      .min(2, "Họ và tên phải có ít nhất 2 ký tự")
      .max(60, "Họ và tên tối đa 60 ký tự"),
    email: z
      .string()
      .min(1, "Vui lòng nhập địa chỉ email")
      .email("Địa chỉ email không đúng định dạng"),
    role: z.enum(["student", "teacher"]),
    password: z
      .string()
      .min(1, "Vui lòng nhập mật khẩu")
      .min(8, "Mật khẩu phải chứa ít nhất 8 ký tự")
      .regex(/[A-Z]/, "Mật khẩu phải có ít nhất 1 chữ hoa")
      .regex(/\d/, "Mật khẩu phải có ít nhất 1 chữ số")
      .regex(/[\p{P}\p{S}]/u, "Mật khẩu phải có ít nhất 1 ký tự đặc biệt"),
    confirmPassword: z
      .string()
      .min(1, "Vui lòng nhập xác nhận mật khẩu"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirmPassword"],
  });

export type RegisterFormData = z.infer<typeof registerSchema>;

export const otpVerifySchema = z.object({
  email: z.string().email("Địa chỉ email không đúng định dạng"),
  token: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/, "Mã OTP phải gồm 6-8 chữ số"),
  type: z.enum(["email", "signup", "recovery"]).default("email"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Vui lòng nhập mật khẩu hiện tại"),
    newPassword: z
      .string()
      .min(1, "Vui lòng nhập mật khẩu mới")
      .min(8, "Mật khẩu mới phải chứa ít nhất 8 ký tự")
      .regex(/[A-Z]/, "Mật khẩu mới phải có ít nhất 1 chữ hoa")
      .regex(/\d/, "Mật khẩu mới phải có ít nhất 1 chữ số")
      .regex(/[\p{P}\p{S}]/u, "Mật khẩu mới phải có ít nhất 1 ký tự đặc biệt"),
    confirmPassword: z
      .string()
      .min(1, "Vui lòng xác nhận mật khẩu mới"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Xác nhận mật khẩu mới không khớp",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Mật khẩu mới phải khác mật khẩu hiện tại",
    path: ["newPassword"],
  });

export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
