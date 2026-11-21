import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Lock, LogIn, AlertCircle, Globe2, Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/hooks/useToast";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { getPostLoginRedirect, preloadDashboardForRole } from "@/routes/navigation";

function getFriendlyAuthError(message: string): string {
  if (/failed to fetch|network request failed/i.test(message)) {
    return "Không thể kết nối đến hệ thống. Vui lòng kiểm tra kết nối và thử lại.";
  }
  if (/provider is not enabled|unsupported provider/i.test(message)) {
    return "Đăng nhập Google chưa được bật trên hệ thống.";
  }
  if (/access_denied|user denied|cancelled|canceled/i.test(message)) {
    return "Bạn đã hủy đăng nhập bằng Google.";
  }
  return message;
}

function readOAuthErrorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const hash = new URLSearchParams(hashRaw);
  const rawError =
    search.get("error_description") ||
    hash.get("error_description") ||
    search.get("error") ||
    hash.get("error");
  if (!rawError) return null;
  try {
    return getFriendlyAuthError(decodeURIComponent(rawError.replace(/\+/g, " ")));
  } catch {
    return getFriendlyAuthError(rawError);
  }
}

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  const login = useAuthStore((state) => state.login);
  const loginWithGoogle = useAuthStore((state) => state.loginWithGoogle);
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const isLoading = useAuthStore((state) => state.isLoading);
  const configurationError = useAuthStore((state) => state.configurationError);
  const toast = useToast();

  const [authError, setAuthError] = useState<string | null>(() => readOAuthErrorFromUrl());
  const [isResetting, setIsResetting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  // Strip OAuth error params from the URL once captured into state
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let dirty = false;
    for (const key of ["error", "error_code", "error_description"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        dirty = true;
      }
    }
    if (url.hash && /error(_description|_code)?=/i.test(url.hash)) {
      url.hash = "";
      dirty = true;
    }
    if (dirty) {
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    }
  }, []);

  // Pre-warm dashboard chunks in idle time for instant navigation
  useEffect(() => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => {
        preloadDashboardForRole("student");
        preloadDashboardForRole("teacher");
        preloadDashboardForRole("admin");
      });
    } else {
      const timer = setTimeout(() => {
        preloadDashboardForRole("student");
        preloadDashboardForRole("teacher");
        preloadDashboardForRole("admin");
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

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
    const email = getValues("email").trim();
    if (!email) {
      setAuthError("Nhập email trước khi yêu cầu đặt lại mật khẩu.");
      return;
    }
    setIsResetting(true);
    setAuthError(null);
    try {
      await resetPassword(email);
      toast.success("Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.", "Kiểm tra hộp thư");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể gửi email đặt lại mật khẩu.";
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
      preloadDashboardForRole(loggedUser.role);
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

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsGoogleLoading(true);
    try {
      const loggedUser = await loginWithGoogle(redirect);
      if (!loggedUser) return;
      preloadDashboardForRole(loggedUser.role);
      toast.success(`Chào mừng ${loggedUser.fullName}.`, "Đăng nhập thành công");
      const destination = getPostLoginRedirect(loggedUser.role, redirect);
      navigate(destination, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Đăng nhập Google thất bại, vui lòng thử lại";
      setAuthError(getFriendlyAuthError(message));
      toast.error(getFriendlyAuthError(message), "Đăng nhập không thành công");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight theme-text-primary">
          Đăng nhập
        </h1>
        <p className="mt-1.5 text-sm theme-text-muted">
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
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          placeholder="student@qizzone.edu.vn"
          leftIcon={<Mail className="h-4 w-4" />}
          error={errors.email?.message}
          autoComplete="email"
          {...register("email")}
        />

        <Input
          label="Mật khẩu"
          type={isPasswordVisible ? "text" : "password"}
          placeholder="••••••••"
          leftIcon={<Lock className="h-4 w-4" />}
          rightIcon={(
            <button
              type="button"
              aria-label={isPasswordVisible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              aria-pressed={isPasswordVisible}
              onClick={() => setIsPasswordVisible(visible => !visible)}
              className="flex h-7 w-7 items-center justify-center rounded theme-text-muted transition theme-hover-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {isPasswordVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
          error={errors.password?.message}
          autoComplete="current-password"
          {...register("password")}
        />

        <div className="-mt-2 flex justify-end">
          <Button type="button" variant="link" size="sm" className="min-h-8 text-xs" isLoading={isResetting} onClick={() => void handleResetPassword()}>
            Quên mật khẩu?
          </Button>
        </div>

        <Button
          type="submit"
          variant="primary"
          className="h-11 w-full"
          isLoading={isLoading}
          leftIcon={<LogIn className="h-4 w-4" />}
        >
          {isLoading ? "Đang xác thực..." : "Đăng nhập"}
        </Button>
      </form>

      <div className="relative flex items-center gap-3 text-xs theme-text-muted">
        <span className="h-px flex-1 theme-surface-inset" />
        <span>hoặc</span>
        <span className="h-px flex-1 theme-surface-inset" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        isLoading={isGoogleLoading}
        onClick={() => void handleGoogleLogin()}
        leftIcon={<Globe2 className="h-4 w-4" />}
      >
        {isGoogleLoading ? "Đang mở Google..." : "Tiếp tục với Google"}
      </Button>

      <div className="border-t theme-border pt-4 text-center text-sm theme-text-muted">
        Chưa có tài khoản?{" "}
        <Link
          to={redirect ? `/register?redirect=${encodeURIComponent(redirect)}` : "/register"}
          className="font-semibold text-blue-700 hover:text-blue-800"
        >
          Tạo tài khoản
        </Link>
      </div>
    </div>
  );
}

export default Login;
