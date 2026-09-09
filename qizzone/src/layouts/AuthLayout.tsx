import { Outlet, Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-[#f6f7f9] px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div className="mb-7 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight text-neutral-950 transition hover:opacity-80"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <span>
              Qiz<span className="text-blue-600">zone</span>
            </span>
          </Link>
          <p className="mt-2 text-sm text-neutral-500">Tạo đề và tổ chức thi trực tuyến</p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <Outlet />
        </div>

        <p className="mt-7 text-center text-xs text-neutral-500">© 2026 Qizzone</p>
      </div>
    </div>
  );
}

export default AuthLayout;
