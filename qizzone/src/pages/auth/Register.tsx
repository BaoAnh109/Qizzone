import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  AlertCircle,
  Check,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/hooks/useToast";
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth";
import { getPostLoginRedirect, preloadDashboardForRole } from "@/routes/navigation";

export function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  const registerUser = useAuthStore((state) => state.register);
  const isLoading = useAuthStore((state) => state.isLoading);
  const toast = useToast();

  const [authError, setAuthError] = useState<string | null>(null);

  // Pre-warm student dashboard chunk in idle time for instant navigation
  useEffect(() => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => {
        preloadDashboardForRole("student");
      });
    } else {
      const timer = setTimeout(() => {
        preloadDashboardForRole("student");
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "student",
    },
  });
  const password = watch("password", "");
  const passwordChecks = [
    { label: "Ít nhất 8 ký tự", passed: password.length >= 8 },
    { label: "Có chữ hoa (A–Z)", passed: /[A-Z]/.test(password) },
    { label: "Có số (0–9)", passed: /\d/.test(password) },
    { label: "Có ký tự đặc biệt", passed: /[\p{P}\p{S}]/u.test(password) },
  ];
  const passwordScore = passwordChecks.filter(check => check.passed).length;
  const passwordStrength = password.length === 0
    ? "Chưa nhập"
    : passwordScore === 4
      ? "Mạnh"
      : passwordScore === 3
        ? "Trung bình"
        : "Yếu";
  const strengthColor = password.length === 0
    ? "theme-text-muted"
    : passwordScore === 4
      ? "text-status-success"
      : passwordScore === 3
        ? "text-status-warning"
        : "text-status-danger";
  const strengthBarColor = passwordScore === 4
    ? "bg-status-success"
    : passwordScore === 3
      ? "bg-status-warning"
      : passwordScore > 0
        ? "bg-status-danger"
        : "theme-surface-inset";
  const onSubmit = async (data: RegisterFormData) => {
    setAuthError(null);
    try {
      const newUser = await registerUser(data);
      preloadDashboardForRole(newUser.role);
      toast.success(
        `Chúc mừng ${newUser.fullName} đã đăng ký tài khoản thành công!`,
        "Đăng ký thành công"
      );
      navigate(getPostLoginRedirect(newUser.role, redirect), {
        replace: true,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Đăng ký thất bại, vui lòng thử lại";
      setAuthError(message);
      toast.error(message, "Đăng ký không thành công");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight theme-text-primary">
          Tạo tài khoản
        </h1>
        <p className="mt-1.5 text-sm theme-text-muted">
          Tài khoản mới sẽ bắt đầu ở vai trò học sinh. Bạn có thể gửi yêu cầu cấp tài khoản giáo viên sau khi đăng nhập.
        </p>
      </div>

      {/* Backend / General Error Alert */}
      {authError && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{authError}</span>
        </div>
      )}

      {/* Register Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Họ và tên"
          placeholder="Nguyễn Văn A"
          leftIcon={<UserIcon className="h-4 w-4" />}
          error={errors.fullName?.message}
          autoComplete="name"
          {...register("fullName")}
        />

        <Input
          label="Email"
          type="email"
          placeholder="your.email@example.com"
          leftIcon={<Mail className="h-4 w-4" />}
          error={errors.email?.message}
          autoComplete="email"
          {...register("email")}
        />

        <div className="space-y-2">
          <Input
            label="Mật khẩu"
            type="password"
            placeholder="••••••••"
            leftIcon={<Lock className="h-4 w-4" />}
            error={errors.password?.message}
            helperText="Dùng chữ hoa, số và ký tự đặc biệt để tăng độ mạnh."
            autoComplete="new-password"
            {...register("password")}
          />
          <div role="group" aria-label="Độ mạnh mật khẩu" className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="theme-text-muted">Độ mạnh mật khẩu</span>
              <span className={`font-medium ${strengthColor}`}>{passwordStrength}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
              {passwordChecks.map((check, index) => (
                <span
                  key={check.label}
                  className={`h-1.5 rounded-full transition-colors ${index < passwordScore ? strengthBarColor : "theme-surface-inset"}`}
                />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
              {passwordChecks.map(({ label, passed }) => (
                <li key={label} className={`flex items-center gap-1.5 ${passed ? "text-status-success" : "theme-text-muted"}`}>
                  {passed ? (
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                  )}
                  <span>{label}</span>
                  <span className="sr-only">{passed ? "đã đạt" : "chưa đạt"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Input
          label="Xác nhận mật khẩu"
          type="password"
          placeholder="••••••••"
          leftIcon={<Lock className="h-4 w-4" />}
          error={errors.confirmPassword?.message}
          autoComplete="new-password"
          {...register("confirmPassword")}
        />

        <Button
          type="submit"
          variant="primary"
          className="mt-2 h-11 w-full"
          isLoading={isLoading}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          {isLoading ? "Đang xử lý..." : "Hoàn tất đăng ký"}
        </Button>
      </form>

      <div className="border-t theme-border pt-4 text-center text-sm theme-text-muted">
        Đã có tài khoản?{" "}
        <Link
          to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login"}
          className="font-semibold text-blue-700 hover:text-blue-800"
        >
          Đăng nhập ngay
        </Link>
      </div>
    </div>
  );
}

export default Register;
