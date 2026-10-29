import {
  UploadCloud,
  PenTool,
  ArrowRight,
  Calculator,
  CheckCircle2,
  SlidersHorizontal,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FileDropzone } from "@/components/teacher/extraction/FileDropzone";

interface QuizCreationEntryProps {
  onManualCreate: () => void;
}

export function QuizCreationEntry({ onManualCreate }: QuizCreationEntryProps) {
  return (
    <div className="space-y-6 pb-12">
      <div className="text-center space-y-1.5 mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
          Khởi tạo đề thi mới
        </h1>
        <p className="text-xs sm:text-sm text-neutral-500 max-w-xl mx-auto">
          Chọn phương thức tạo đề phù hợp: Tải tệp đề có sẵn / Dán văn bản để hệ thống tự động bóc tách hoặc tự soạn thảo thủ công từng câu hỏi.
        </p>
      </div>

      {/* 50/50 Split layout on large screens: 2 card bằng nhau */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* LEFT COLUMN: 50% Thả file hoặc Dán text */}
        <div className="flex flex-col space-y-2.5 h-full">
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-900 pb-1 border-b border-neutral-200">
            <UploadCloud className="h-4 w-4 text-blue-600" />
            <span>Phương thức 1: Nhập đề tự động</span>
          </div>

          <div className="flex-1 flex flex-col">
            <FileDropzone />
          </div>
        </div>

        {/* RIGHT COLUMN: 50% Tạo đề thủ công */}
        <div className="flex flex-col space-y-2.5 h-full">
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-900 pb-1 border-b border-neutral-200">
            <PenTool className="h-4 w-4 text-indigo-600" />
            <span>Phương thức 2: Soạn thảo câu hỏi trực tiếp</span>
          </div>

          <Card className="flex-1 flex flex-col justify-between border-neutral-200 bg-white hover:border-indigo-300 transition shadow-xs">
            <CardHeader className="pb-3 pt-4 px-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-2xs shrink-0">
                  <PenTool className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base sm:text-lg font-bold text-neutral-900">
                    Tạo đề thi thủ công
                  </CardTitle>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Tự soạn từng câu hỏi với công thức KaTeX & cấu hình phòng thi
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 flex-1 flex flex-col justify-between px-5 pb-5 pt-0">
              <div className="space-y-2.5 text-xs text-neutral-600">
                <div className="flex items-start gap-2.5 rounded-xl bg-neutral-50 p-2.5 border border-neutral-100">
                  <Calculator className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-neutral-900 font-semibold block mb-0.5">
                      Hỗ trợ công thức Toán LaTeX / KaTeX
                    </strong>
                    Soạn thảo công thức dạng $x^2 + y^2 = r^2$, phân số, tích phân với xem trước tức thì.
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl bg-neutral-50 p-2.5 border border-neutral-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-neutral-900 font-semibold block mb-0.5">
                      Đầy đủ 4 phương án trắc nghiệm A, B, C, D
                    </strong>
                    Tùy chọn đáp án đúng, thêm lời giải chi tiết giải thích cho từng câu hỏi khi học sinh xem lại.
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl bg-neutral-50 p-2.5 border border-neutral-100">
                  <SlidersHorizontal className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-neutral-900 font-semibold block mb-0.5">
                      Cấu hình phòng thi linh hoạt
                    </strong>
                    Thiết lập thời gian làm bài, xáo trộn câu hỏi, xáo trộn đáp án, số lần làm tối đa.
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-100">
                <Button
                  variant="primary"
                  size="md"
                  onClick={onManualCreate}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                  className="w-full font-bold bg-indigo-600 hover:bg-indigo-700 shadow-sm"
                >
                  Bắt đầu soạn đề thủ công
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default QuizCreationEntry;
