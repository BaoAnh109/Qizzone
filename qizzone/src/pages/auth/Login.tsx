import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Mail, Lock, LogIn, GraduationCap, UserCheck } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/hooks/useToast";
import type { UserRole } from "@/types/auth";

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/teacher";

  const login = useAuthStore((state) => state.login);
  const toast = useToast();

  const [email, setEmail] = useState("teacher@qizzone.edu.vn");
  const [password, setPassword] = useState("123456");
  const [role, setRole] = useState<UserRole>("teacher");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const handleFillDemo = (demoRole: UserRole) => {
    setRole(demoRole);
    if (demoRole === "teacher") {
      setEmail("teacher@qizzone.edu.vn");
      setPassword("123456");
    } else {
      setEmail("student@qizzone.edu.vn");
      setPassword("123456");
    }
    setErrors({});
  };

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const newErrors: { email?: string; password?: string } = {};
    if (!email.trim()) newErrors.email = "Vui lòng nhập địa chỉ email";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      newErrors.email = "Email không hợp lệ";

    if (!password) newErrors.password = "Vui lòng nhập mật khẩu";
    else if (password.length < 6)
      newErrors.password = "Mật khẩu phải có ít nhất 6 ký tự";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    setTimeout(() => {
      setIsLoading(false);
      const isTeacher = role === "teacher" || email.includes("teacher");

      login({
        id: isTeacher ? "tea-001" : "stu-001",
        name: isTeacher ? "Thầy Nguyễn Văn Anh" : "Em Trần Bảo Nam",
        fullName: isTeacher ? "Thầy Nguyễn Văn Anh" : "Em Trần Bảo Nam",
        email: email.trim(),
        role: isTeacher ? "teacher" : "student",
      });

      toast.success(
        `Đăng nhập thành công với vai trò ${isTeacher ? "Giáo viên" : "Học sinh"}!`,
        "Chào mừng bạn trở lại"
      );

      if (redirect && redirect !== "/login" && redirect !== "/register") {
        navigate(redirect, { replace: true });
      } else {
        navigate(isTeacher ? "/teacher" : "/student", { replace: true });
      }
    }, 500);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-neutral-900">Đăng nhập tài khoản</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Chọn vai trò và đăng nhập để bắt đầu trải nghiệm
        </p>
      </div>

      {/* Quick Demo Selector */}
      <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-200/80">
        <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2 text-center">
          1-Click Điền tài khoản Demo kiểm thử:
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant={role === "teacher" ? "primary" : "outline"}
            leftIcon={<GraduationCap className="h-3.5 w-3.5" />}
            onClick={() => handleFillDemo("teacher")}
            className="w-full text-xs"
          >
            Giáo viên Demo
          </Button>
          <Button
            type="button"
            size="sm"
            variant={role === "student" ? "primary" : "outline"}
            leftIcon={<UserCheck className="h-3.5 w-3.5" />}
            onClick={() => handleFillDemo("student")}
            className="w-full text-xs"
          >
            Học sinh Demo
          </Button>
        </div>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <Input
          label="Địa chỉ Email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          placeholder="teacher@qizzone.edu.vn"
          leftIcon={<Mail className="h-4 w-4" />}
          error={errors.email}
          autoComplete="email"
        />

        <Input
          label="Mật khẩu"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          placeholder="••••••••"
          leftIcon={<Lock className="h-4 w-4" />}
          error={errors.password}
          autoComplete="current-password"
        />

        <Button
          type="submit"
          variant="primary"
          className="w-full h-11 text-sm font-semibold"
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