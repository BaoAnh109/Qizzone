import { Outlet, useNavigate } from "react-router-dom";
import { GraduationCap, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ExamLayoutProps {
  mode?: "exam" | "practice";
}

export function ExamLayout({ mode = "exam" }: ExamLayoutProps) {
  const navigate = useNavigate();
  const isPractice = mode === "practice";

  const handleExit = () => {
    const message = isPractice
      ? "Bạn có chắc chắn muốn rời phòng luyện tập? Câu trả lời chưa kiểm tra vẫn được lưu trên trình duyệt này để bạn tiếp tục sau."
      : "Bạn có chắc chắn muốn rời khỏi phòng thi?";

    if (window.confirm(message)) {
      navigate(isPractice ? "/student/practice" : "/student");
    }
  };

  return (
    <div className="app-shell flex min-h-screen select-none flex-col">
      {/* Exam Header */}
      <header className="sticky top-0 z-30 h-14 border-b theme-border theme-surface px-4 sm:px-6 lg:px-8">
        <div className="flex h-full w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <span className="font-bold text-neutral-900 text-base">
              Qizzone <span className="text-xs font-normal text-neutral-500">· {isPractice ? "Phòng luyện tập" : "Phòng thi trực tuyến"}</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 sm:flex">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="font-medium">{isPractice ? "Luyện từng câu, kiểm tra ngay" : "Chế độ thi an toàn"}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExit}
            >
              Thoát
            </Button>
          </div>
        </div>
      </header>

      {/* Main Exam Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default ExamLayout;
