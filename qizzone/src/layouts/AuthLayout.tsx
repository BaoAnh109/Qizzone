import { Outlet, Link } from "react-router-dom";
import { Sparkles, GraduationCap } from "lucide-react";

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col justify-center bg-linear-to-br from-indigo-50/70 via-white to-neutral-50 px-4 py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative gradient background blur */}
      <div
        className="pointer-events-none absolute -top-40 -right-40 h-96 w-96 rounded-full bg-indigo-200/40 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-2xl font-black tracking-tight text-neutral-950 transition hover:opacity-90"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-200">
              <GraduationCap className="h-6 w-6" />
            </div>
            <span>
              Qiz<span className="text-indigo-600">zone</span>
            </span>
          </Link>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-neutral-500">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            <span>Nền tảng Tạo đề & Thi trắc nghiệm trực tuyến</span>
          </div>
        </div>

        {/* Content Outlet (Login / Register Form) */}
        <div className="rounded-2xl border border-neutral-200/80 bg-white/90 p-6 sm:p-8 shadow-xl shadow-neutral-900/5 backdrop-blur-md">
          <Outlet />
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-neutral-400">
          <p>© 2026 Qizzone Enterprise. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
