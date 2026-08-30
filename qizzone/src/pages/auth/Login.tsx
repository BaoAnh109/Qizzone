import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Lock, LogIn, GraduationCap, UserCheck, AlertCircle } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/hooks/useToast";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import type { UserRole } from "@/types/auth";

/**
 * Resolves destination URL after login based on user role to avoid 403 forbidden redirects
 */
function getPostLoginRedirect(role: UserRole, redirectParam: string | null): string {
  if (
    !redirectParam ||
    redirectParam === "/login" ||
    redirectParam === "/register" ||
    redirectParam === "/unauthorized"
  ) {
    return role === "teacher" ? "/teacher" : "/student";
  }

  // If redirect is for teacher route but logged-in user is a student
  if (redirectParam.startsWith("/teacher") && role !== "teacher") {
    return "/student";
  }

  // If redirect is for student route but logged-in user is a teacher
  if (redirectParam.startsWith("/student") && role !== "student") {
    return "/teacher";
  }

  return redirectParam;
}

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  const login = useAuthStore((state) => state.login);
  const isLoading = useAuthStore((state) => state.isLoading);
  const toast = useToast();

  const [activeDemoRole, setActiveDemoRole] = useState<UserRole | null>("teacher");
  const [authError, setAuthError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "teacher@qizzone.edu.vn",
      password: "123456",
    },
  });

  const handleQuickDemo = (role: UserRole) => {
    setActiveDemoRole(role);
    setAuthError(null);
    clearErrors();

    if (role === "teacher") {
      setValue("email", "teacher@qizzone.edu.vn", { shouldValidate: true });
      setValue("password", "123456", { shouldValidate: true });
    } else {
      setValue("email", "student@qizzone.edu.vn", { shouldValidate: true });
      setValue("password", "123456", { shouldValidate: true });
    }
  };

  const onSubmit = async (data: LoginFormData) => {
    setAuthError(null);
    try {
      const loggedUser = await login(data);
      toast.success(
        `Chào mừng ${loggedUser.fullName} (${loggedUser.role === "teacher" ? "Giáo viên" : "Học sinh"}) đã đăng nhập thành công!`,
        "Đăng nhập thành công"
      );

      const destination = getPostLoginRedirect(loggedUser.role, redirect);
      navigate(destination, { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Đăng nhập thất bại, vui lòng thử lại";
      setAuthError(message);
      toast.error(message, "Đăng nhập không thành công");
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">
          Đăng nhập tài khoản
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Hệ thống tạo đề & thi trắc nghiệm trực tuyến thế hệ mới
        </p>
      </div>

      {/* 1-Click Demo Accounts Selector */}
      <div className="rounded-xl bg-neutral-50 p-3.5 border border-neutral-200/80">
        <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2 text-center">
          1-Click Điền tài khoản Demo kiểm thử:
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant={activeDemoRole === "teacher" ? "primary" : "outline"}
            leftIcon={<GraduationCap className="h-3.5 w-3.5" />}
            onClick={() => handleQuickDemo("teacher")}
            className="w-full text-xs font-semibold"
          >
            Giáo viên Demo
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeDemoRole === "student" ? "primary" : "outline"}
            leftIcon={<UserCheck className="h-3.5 w-3.5" />}
            onClick={() => handleQuickDemo("student")}
            className="w-full text-xs font-semibold"
          >
            Học sinh Demo
          </Button>
        </div>
      </div>

      {/* Backend / General Error Alert */}
      {authError && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 border border-rose-200 text-xs font-medium text-rose-800 animate-in fade-in">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{authError}</span>
        </div>
      )}

      {/* React Hook Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Địa chỉ Email"
          type="email"
          placeholder="teacher@qizzone.edu.vn"
          leftIcon={<Mail className="h-4 w-4" />}
          error={errors.email?.message}
          autoComplete="email"
          {...register("email")}
        />

        <Input
          label="Mật khẩu"
          type="password"
          placeholder="••••••••"
          leftIcon={<Lock className="h-4 w-4" />}
          error={errors.password?.message}
          autoComplete="current-password"
          {...register("password")}
        />

        <Button
          type="submit"
          variant="primary"
          className="w-full h-11 text-sm font-semibold mt-2"
          isLoading={isLoading}
          leftIcon={<LogIn className="h-4 w-4" />}
        >
          {isLoading ? "Đang xác thực..." : "Đăng nhập ngay"}
        </Button>
      </form>

      <div className="text-center text-xs text-neutral-500 pt-2 border-t border-neutral-100">
        Chưa có tài khoản?{" "}
        <Link
          to="/register"
          className="font-semibold text-indigo-600 hover:text-indigo-700 underline"
        >
          Đăng ký tài khoản mới
        </Link>
      </div>
    </div>
  );
}

export default Login;