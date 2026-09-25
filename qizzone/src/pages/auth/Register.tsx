import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/hooks/useToast";
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth";

export function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const registerUser = useAuthStore((state) => state.register);
  const isLoading = useAuthStore((state) => state.isLoading);
  const toast = useToast();

  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (isInitialized && isAuthenticated && user) {
      const home = user.role === "admin" ? "/admin/teacher-approvals" : user.role === "student" ? "/student" : "/teacher";
      navigate(redirect || home, { replace: true });
    }
  }, [isInitialized, isAuthenticated, user, redirect, navigate]);

  const {
    register,
    handleSubmit,
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
  const onSubmit = async (data: RegisterFormData) => {
    setAuthError(null);
    try {
      const newUser = await registerUser(data);
      toast.success(
        `Chúc mừng ${newUser.fullName} đã đăng ký tài khoản thành công!`,
        "Đăng ký thành công"
      );
      navigate(redirect || "/student", {
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
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">
          Tạo tài khoản
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
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

        <Input
          label="Mật khẩu"
          type="password"
          placeholder="••••••••"
          leftIcon={<Lock className="h-4 w-4" />}
          error={errors.password?.message}
          helperText="Tối thiểu 6 ký tự."
          autoComplete="new-password"
          {...register("password")}
        />

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

      <div className="border-t border-neutral-100 pt-4 text-center text-sm text-neutral-500">
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
