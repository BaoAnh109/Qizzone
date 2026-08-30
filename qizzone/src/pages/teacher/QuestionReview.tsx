import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function QuestionReview() {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between border-b border-neutral-200/80 pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/teacher/quizzes")}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Quay lại
          </Button>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">
              Xem trước đề thi & Kiểm duyệt
            </h1>
            <p className="text-xs text-neutral-500">
              Kiểm tra nội dung câu hỏi, công thức và đáp án trước khi mở phòng thi.
            </p>
          </div>
        </div>

        <Badge variant="published">Đã sẵn sàng</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Câu 1: Cho hàm số f(x) = x³ - 3x + 2. Giá trị cực tiểu của hàm số là:
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-neutral-200 p-3 text-sm">
              A. y = 0
            </div>
            <div className="rounded-lg border border-emerald-500 bg-emerald-50/50 p-3 text-sm font-medium text-emerald-950 flex items-center justify-between">
              <span>B. y = 0 tại x = 1 (Đáp án đúng)</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="rounded-lg border border-neutral-200 p-3 text-sm">
              C. y = 4
            </div>
            <div className="rounded-lg border border-neutral-200 p-3 text-sm">
              D. y = -2
            </div>
          </div>

          <div className="rounded-lg bg-neutral-50 p-3 border border-neutral-200/80 text-xs text-neutral-600 mt-2">
            <strong className="text-neutral-800">Lời giải chi tiết:</strong> Ta có f'(x) = 3x² - 3 = 0 ⇔ x = ±1. Điểm cực tiểu đạt tại x = 1, suy ra y_ct = 0.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default QuestionReview;
