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
      <div className="text-center space-y-2 mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
          Khởi tạo đề thi mới
        </h1>
        <p className="text-xs sm:text-sm text-neutral-500 max-w-xl mx-auto">
          Chọn phương thức tạo đề phù hợp: Tải tệp đề có sẵn (Word/PDF/Ảnh) để hệ thống tự động bóc tách hoặc tự soạn thảo thủ công từng câu hỏi.
        </p>
      </div>

      {/* 50/50 Split layout on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* LEFT COLUMN: 50% Dropzone tải file */}
        <div className="flex flex-col space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-900 pb-1 border-b border-neutral-200">
            <UploadCloud className="h-4 w-4 text-blue-600" />
            <span>Tải lên tệp đề thi (Word / PDF / Ảnh)</span>
          </div>

          <div className="flex-1">
            <FileDropzone />
          </div>
        </div>

        {/* RIGHT COLUMN: 50% Tạo đề thủ công */}
        <div className="flex flex-col space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-900 pb-1 border-b border-neutral-200">
            <PenTool className="h-4 w-4 text-indigo-600" />
            <span>Soạn thảo câu hỏi trực tiếp</span>
          </div>

          <Card className="flex-1 flex flex-col justify-between border-neutral-200 bg-white hover:border-indigo-300 transition shadow-xs">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-2xs">
                  <PenTool className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold text-neutral-900">
                    Tạo đề thi thủ công
                  </CardTitle>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Tự soạn từng câu hỏi với trình biên soạn công thức Toán KaTeX trực quan
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 flex-1 flex flex-col justify-between pt-0">
              <div className="space-y-3 text-xs text-neutral-600">
                <div className="flex items-start gap-2.5 rounded-xl bg-neutral-50 p-3 border border-neutral-100">
                  <Calculator className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-neutral-900 font-semibold block mb-0.5">
                      Hỗ trợ công thức Toán LaTeX / KaTeX
                    </strong>
                    Soạn thảo công thức dạng $x^2 + y^2 = r^2$, phân số, tích phân, ma trận với xem trước trực quan tức thì.
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl bg-neutral-50 p-3 border border-neutral-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-neutral-900 font-semibold block mb-0.5">
                      Đầy đủ 4 phương án trắc nghiệm A, B, C, D
                    </strong>
                    Tùy chọn đáp án đúng, thêm lời giải chi tiết giải thích cho từng câu hỏi khi học sinh xem lại kết quả.
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl bg-neutral-50 p-3 border border-neutral-100">
                  <SlidersHorizontal className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-neutral-900 font-semibold block mb-0.5">
                      Cấu hình phòng thi linh hoạt
                    </strong>
                    Thiết lập thời gian làm bài, xáo trộn câu hỏi, xáo trộn đáp án, số lần làm tối đa và xuất bản ngay.
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-100">
                <Button
                  variant="primary"
                  size="md"
                  onClick={onManualCreate}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                  className="w-full font-bold bg-indigo-600 hover:bg-indigo-700 shadow-sm h-11 text-sm"
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
