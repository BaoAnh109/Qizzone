import { Link } from "react-router-dom";
import { ShieldAlert, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function Unauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12 text-center">
      <div className="mx-auto max-w-md space-y-6">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-rose-100 text-rose-600 shadow-lg shadow-rose-100">
          <ShieldAlert className="h-10 w-10" />
        </div>

        <div className="space-y-2">
          <span className="text-sm font-semibold tracking-wider text-rose-600 uppercase">
            Mã lỗi: 403 Forbidden
          </span>
          <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight sm:text-4xl">
            Không có quyền truy cập
          </h1>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            Tài khoản của bạn không có vai trò phù hợp để truy cập vào phân vùng này. Vui lòng chuyển tài khoản hoặc quay về trang chủ.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link to="/login" className="w-full sm:w-auto">
            <Button variant="primary" className="w-full sm:w-auto" leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Đăng nhập lại
            </Button>
          </Link>
          <Link to="/" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full sm:w-auto" leftIcon={<Home className="h-4 w-4" />}>
              Về trang chủ
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Unauthorized;