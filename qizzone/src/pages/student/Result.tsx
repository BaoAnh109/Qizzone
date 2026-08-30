import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Home, Award } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function Result() {
  const navigate = useNavigate();
  const { resultId } = useParams();

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-600 shadow-lg shadow-emerald-100">
          <Award className="h-10 w-10" />
        </div>
        <Badge variant="success" size="md">
          Đạt yêu cầu (Passed)
        </Badge>
        <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight">
          Kết quả bài kiểm tra
        </h1>
        <p className="text-xs text-neutral-500">Mã kết quả: #{resultId || "RES-9981"}</p>
      </div>

      {/* Score Summary Card */}
      <Card className="text-center overflow-hidden border-neutral-200">
        <CardContent className="p-8 space-y-6">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">
              Điểm số tổng kết
            </span>
            <div className="text-5xl font-black text-indigo-600 tracking-tight">
              9.0 <span className="text-xl font-normal text-neutral-400">/ 10</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-neutral-100">
            <div className="rounded-xl bg-emerald-50/80 p-3 border border-emerald-100">
              <span className="text-xs text-emerald-700 font-medium">Số câu đúng</span>
              <p className="text-xl font-bold text-emerald-900 mt-0.5">18</p>
            </div>
            <div className="rounded-xl bg-rose-50/80 p-3 border border-rose-100">
              <span className="text-xs text-rose-700 font-medium">Số câu sai</span>
              <p className="text-xl font-bold text-rose-900 mt-0.5">2</p>
            </div>
            <div className="rounded-xl bg-indigo-50/80 p-3 border border-indigo-100">
              <span className="text-xs text-indigo-700 font-medium">Thời gian</span>
              <p className="text-xl font-bold text-indigo-900 mt-0.5">28:15</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => navigate("/student")}
              leftIcon={<Home className="h-4 w-4" />}
              className="w-full sm:w-auto"
            >
              Về trang học sinh
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate("/student")}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="w-full sm:w-auto"
            >
              Làm bài kiểm tra khác
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Result;
