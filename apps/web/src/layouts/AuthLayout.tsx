import { Outlet, Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { ThemeToggle } from "@/components/common/ThemeToggle";

export function AuthLayout() {
  return (
    <div className="app-shell flex min-h-screen flex-col px-4 py-8 sm:px-6">
      <ThemeToggle
        variant="compact"
        className="fixed right-4 top-4 z-20 sm:right-6 sm:top-6"
      />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div className="mb-7 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 font-display text-xl font-bold tracking-tight theme-text-primary transition-opacity hover:opacity-80"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <span>
              Qiz<span className="text-primary">zone</span>
            </span>
          </Link>
          <p className="mt-2 text-sm theme-text-muted">Tạo đề và tổ chức thi trực tuyến</p>
        </div>

        <div className="rounded-2xl border theme-border theme-surface-raised p-5 shadow-md sm:p-8">
          <Outlet />
        </div>

        <p className="mt-7 text-center text-xs theme-text-muted">© 2026 Qizzone</p>
      </div>
    </div>
  );
}

export default AuthLayout;
