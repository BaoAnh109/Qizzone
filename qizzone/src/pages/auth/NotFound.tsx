import { Link } from "react-router-dom";
import { Compass, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12 text-center">
      <div className="mx-auto max-w-md space-y-6">
        <div className="relative inline-flex">
          <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <Compass className="h-10 w-10" />
          </div>
          <span className="absolute -right-3 -top-2 rounded bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">
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
