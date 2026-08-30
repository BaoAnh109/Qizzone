import { Outlet, useNavigate } from "react-router-dom";
import { GraduationCap, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function ExamLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-neutral-100/70 select-none">
      {/* Exam Header */}
      <header className="sticky top-0 z-30 h-14 border-b border-neutral-200 bg-white/95 px-4 sm:px-8 shadow-2xs backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <span className="font-bold text-neutral-900 text-base">
              Qizzone <span className="text-xs font-normal text-neutral-500">· Phòng thi trực tuyến</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="font-medium">Chế độ thi an toàn</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (window.confirm("Bạn có chắc chắn muốn rời khỏi phòng thi?")) {
                  navigate("/student");
                }
              }}
            >
              Thoát
            </Button>
          </div>
        </div>
      </header>

      {/* Main Exam Area */}
      <main className="flex-1 p-3 sm:p-6">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default ExamLayout;
