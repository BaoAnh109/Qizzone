import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Mail,
  Lock,
  User as UserIcon,
  UserCheck,
  GraduationCap,
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
  const registerUser = useAuthStore((state) => state.register);
  const isLoading = useAuthStore((state) => state.isLoading);
  const toast = useToast();

  const [authError, setAuthError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
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
  const selectedRole = useWatch({ control, name: "role" });

  const onSubmit = async (data: RegisterFormData) => {
    setAuthError(null);
    try {
      const newUser = await registerUser(data);
      if (newUser.approvalStatus === "pending") {
        toast.info(
          "Yêu cầu đã được gửi. Bạn chỉ có thể đăng nhập sau khi quản trị viên xét duyệt.",
          "Đang chờ duyệt"
        );
        navigate("/login", { replace: true });
        return;
      }
      toast.success(
        `Chúc mừng ${newUser.fullName} đã đăng ký tài khoản thành công!`,
        "Đăng ký thành công"
      );
      navigate(newUser.role === "teacher" ? "/teacher" : "/student", {
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
          Điền thông tin và chọn vai trò phù hợp.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={`cursor-pointer rounded-md border p-3.5 transition-colors ${selectedRole === "student" ? "border-blue-600 bg-blue-50 text-blue-950 ring-1 ring-blue-600" : "border-neutral-200 bg-white text-neutral-700 hover:border-blue-300"}`}>
          <input type="radio" value="student" className="sr-only" {...register("role")} />
          <UserCheck className="mb-2 h-5 w-5 text-blue-600" />
          <span className="block text-xs font-semibold">Học sinh</span>
          <span className="mt-1 block text-[11px] leading-4 text-neutral-500">Dùng được ngay sau đăng ký</span>
        </label>
        <label className={`cursor-pointer rounded-md border p-3.5 transition-colors ${selectedRole === "teacher" ? "border-blue-600 bg-blue-50 text-blue-950 ring-1 ring-blue-600" : "border-neutral-200 bg-white text-neutral-700 hover:border-blue-300"}`}>
          <input type="radio" value="teacher" className="sr-only" {...register("role")} />
          <GraduationCap className="mb-2 h-5 w-5 text-blue-600" />
          <span className="block text-xs font-semibold">Giáo viên</span>
          <span className="mt-1 block text-[11px] leading-4 text-neutral-500">Cần quản trị viên xét duyệt</span>
        </label>
      </div>
      {errors.role?.message && <p className="text-xs text-rose-600">{errors.role.message}</p>}

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
          to="/login"
          className="font-semibold text-blue-700 hover:text-blue-800"
        >
          Đăng nhập ngay
        </Link>
      </div>
    </div>
  );
}

export default Register;
