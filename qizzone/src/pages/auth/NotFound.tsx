import { Link } from "react-router-dom";
import { Compass, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-neutral-50 to-indigo-50/30 px-4 py-12 text-center">
      <div className="mx-auto max-w-md space-y-6">
        <div className="relative inline-flex">
          <div className="h-24 w-24 rounded-3xl bg-indigo-100/80 flex items-center justify-center text-indigo-600 shadow-xl shadow-indigo-100/50">
            <Compass className="h-12 w-12 animate-pulse" />
          </div>
          <span className="absolute -top-2 -right-2 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm">
            404
          </span>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight sm:text-4xl">
            Không tìm thấy trang
          </h1>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            Đường dẫn bạn đang truy cập không tồn tại hoặc đã được di chuyển sang địa chỉ mới.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Button
            variant="primary"
            onClick={() => window.history.back()}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Quay lại trang trước
          </Button>

          <Link to="/" className="w-full sm:w-auto">
            <Button
              variant="outline"
              leftIcon={<Home className="h-4 w-4" />}
              className="w-full sm:w-auto"
            >
              Về trang chủ
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
