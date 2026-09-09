import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Lock, LogIn, AlertCircle } from "lucide-react";
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
  const home = role === "admin" ? "/admin/teacher-approvals" : role === "student" ? "/student" : "/teacher";
  if (
    !redirectParam ||
    redirectParam === "/login" ||
    redirectParam === "/register" ||
    redirectParam === "/unauthorized"
  ) {
    return home;
  }

  if (redirectParam.startsWith("/admin") && role !== "admin") return home;

  // If redirect is for teacher route but logged-in user is a student
  if (redirectParam.startsWith("/teacher") && role === "student") {
    return "/student";
  }

  // If redirect is for student route but logged-in user is a teacher
  if (redirectParam.startsWith("/student") && role !== "student") {
    return home;
  }

  return redirectParam;
}

function getFriendlyAuthError(message: string): string {
  if (/failed to fetch|network request failed/i.test(message)) {
    return "Không thể kết nối đến hệ thống. Vui lòng kiểm tra kết nối và thử lại.";
  }
  return message;
}

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  const login = useAuthStore((state) => state.login);
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const isLoading = useAuthStore((state) => state.isLoading);
  const configurationError = useAuthStore((state) => state.configurationError);
  const toast = useToast();

  const [authError, setAuthError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleResetPassword = async () => {
    const email = getValues('email').trim();
    if (!email) {
      setAuthError('Nhập email trước khi yêu cầu đặt lại mật khẩu.');
      return;
    }
    setIsResetting(true);
    setAuthError(null);
    try {
      await resetPassword(email);
      toast.success('Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.', 'Kiểm tra hộp thư');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể gửi email đặt lại mật khẩu.';
      setAuthError(message);
      toast.error(message);
    } finally {
      setIsResetting(false);
    }
  };

  const onSubmit = async (data: LoginFormData) => {
    setAuthError(null);
    try {
      const loggedUser = await login(data);
      toast.success(`Chào mừng ${loggedUser.fullName}.`, "Đăng nhập thành công");

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">
          Đăng nhập
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Sử dụng tài khoản Qizzone của bạn để tiếp tục.
        </p>
      </div>

      {/* Backend / General Error Alert */}
      {(authError || configurationError) && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{getFriendlyAuthError((authError || configurationError)!)}</span>
        </div>
      )}

      {/* React Hook Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Email"
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

        <div className="flex justify-end">
          <Button type="button" variant="link" size="sm" isLoading={isResetting} onClick={() => void handleResetPassword()}>
            Quên mật khẩu?
          </Button>
        </div>

        <Button
          type="submit"
          variant="primary"
          className="mt-2 h-11 w-full"
          isLoading={isLoading}
          leftIcon={<LogIn className="h-4 w-4" />}
        >
          {isLoading ? "Đang xác thực..." : "Đăng nhập"}
        </Button>
      </form>

      <div className="border-t border-neutral-100 pt-4 text-center text-sm text-neutral-500">
        Chưa có tài khoản?{" "}
        <Link
          to="/register"
          className="font-semibold text-blue-700 hover:text-blue-800"
        >
          Tạo tài khoản
        </Link>
      </div>
    </div>
  );
}

export default Login;
