import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Mail,
  Lock,
  User as UserIcon,
  GraduationCap,
  UserCheck,
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
    setValue,
    control,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "teacher",
    },
  });

  const selectedRole = useWatch({ control, name: "role" });

  const onSubmit = async (data: RegisterFormData) => {
    setAuthError(null);
    try {
      const newUser = await registerUser(data);
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
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">
          Đăng ký tài khoản
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Tạo tài khoản Giáo viên hoặc Học sinh để tham gia Qizzone
        </p>
      </div>

      {/* Role Selection Cards */}
      <div>
        <label className="block text-xs font-semibold text-neutral-700 mb-2">
          Bạn tham gia với tư cách:
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setValue("role", "teacher", { shouldValidate: true })}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-center transition cursor-pointer ${
              selectedRole === "teacher"
                ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold shadow-xs"
                : "border-neutral-200 hover:border-neutral-300 text-neutral-700 bg-white"
            }`}
          >
            <GraduationCap
              className={`h-5 w-5 ${
                selectedRole === "teacher" ? "text-indigo-600" : "text-neutral-500"
              }`}
            />
            <span className="text-xs">Giáo viên</span>
          </button>

          <button
            type="button"
            onClick={() => setValue("role", "student", { shouldValidate: true })}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3.5 text-center transition cursor-pointer ${
              selectedRole === "student"
                ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold shadow-xs"
                : "border-neutral-200 hover:border-neutral-300 text-neutral-700 bg-white"
            }`}
          >
            <UserCheck
              className={`h-5 w-5 ${
                selectedRole === "student" ? "text-indigo-600" : "text-neutral-500"
              }`}
            />
            <span className="text-xs">Học sinh</span>
          </button>
        </div>
        {errors.role && (
          <p className="mt-1 text-xs text-rose-600">{errors.role.message}</p>
        )}
      </div>

      {/* Backend / General Error Alert */}
      {authError && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 border border-rose-200 text-xs font-medium text-rose-800 animate-in fade-in">
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
          label="Địa chỉ Email"
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
          className="w-full h-11 text-sm font-semibold mt-2"
          isLoading={isLoading}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          {isLoading ? "Đang xử lý..." : "Hoàn tất đăng ký"}
        </Button>
      </form>

      <div className="text-center text-xs text-neutral-500 pt-2 border-t border-neutral-100">
        Đã có tài khoản?{" "}
        <Link
          to="/login"
          className="font-semibold text-indigo-600 hover:text-indigo-700 underline"
        >
          Đăng nhập ngay
        </Link>
      </div>
    </div>
  );
}

export default Register;