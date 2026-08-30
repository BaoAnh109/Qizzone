import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Mail, Lock, User as UserIcon, GraduationCap, UserCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/hooks/useToast";
import type { UserRole } from "@/types/auth";

export function Register() {
  const navigate = useNavigate();
  const toast = useToast();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("teacher");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    fullName?: string;
    email?: string;
    password?: string;
  }>({});

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: { fullName?: string; email?: string; password?: string } = {};
    if (!fullName.trim()) newErrors.fullName = "Vui lòng nhập họ và tên";
    if (!email.trim()) newErrors.email = "Vui lòng nhập email";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      newErrors.email = "Email không đúng định dạng";
    if (!password) newErrors.password = "Vui lòng nhập mật khẩu";
    else if (password.length < 6)
      newErrors.password = "Mật khẩu tối thiểu 6 ký tự";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    setTimeout(() => {
      setIsLoading(false);
      toast.success(
        "Tài khoản đã được tạo thành công! Vui lòng đăng nhập.",
        "Đăng ký thành công"
      );
      navigate("/login");
    }, 600);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-neutral-900">Đăng ký tài khoản</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Tạo tài khoản Giáo viên hoặc Học sinh để tham gia Qizzone
        </p>
      </div>

      {/* Role Selection */}
      <div>
        <label className="block text-xs font-semibold text-neutral-700 mb-2">
          Bạn tham gia với tư cách:
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setRole("teacher")}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition cursor-pointer ${
              role === "teacher"
                ? "border-indigo-600 bg-indigo-50/60 text-indigo-950 font-semibold"
                : "border-neutral-200 hover:border-neutral-300 text-neutral-700"
            }`}
          >
            <GraduationCap className={`h-5 w-5 ${role === "teacher" ? "text-indigo-600" : "text-neutral-500"}`} />
            <span className="text-xs">Giáo viên</span>
          </button>

          <button
            type="button"
            onClick={() => setRole("student")}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition cursor-pointer ${
              role === "student"
                ? "border-indigo-600 bg-indigo-50/60 text-indigo-950 font-semibold"
                : "border-neutral-200 hover:border-neutral-300 text-neutral-700"
            }`}
          >
            <UserCheck className={`h-5 w-5 ${role === "student" ? "text-indigo-600" : "text-neutral-500"}`} />
            <span className="text-xs">Học sinh</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        <Input
          label="Họ và tên"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nguyễn Văn A"
          leftIcon={<UserIcon className="h-4 w-4" />}
          error={errors.fullName}
        />

        <Input
          label="Địa chỉ Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your.email@example.com"
          leftIcon={<Mail className="h-4 w-4" />}
          error={errors.email}
        />

        <Input
          label="Mật khẩu"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          leftIcon={<Lock className="h-4 w-4" />}
          error={errors.password}
          helperText="Tối thiểu 6 ký tự bao gồm chữ và số."
        />

        <Button
          type="submit"
          variant="primary"
          className="w-full h-11 text-sm font-semibold"
          isLoading={isLoading}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          {isLoading ? "Đang tạo tài khoản..." : "Hoàn tất đăng ký"}
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