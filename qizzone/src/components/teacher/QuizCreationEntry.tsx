import { useState } from "react";
import {
  UploadCloud,
  PenTool,
  ClipboardPaste,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { FileDropzone } from "@/components/teacher/extraction/FileDropzone";
import { extractQuizWithAI } from "@/services/aiExtractionService";
import { useExtractionStore } from "@/store/extractionStore";
import { useToast } from "@/hooks/useToast";
import type { Question } from "@/types/quiz";
import { mapExtractedQuestionsToQuizQuestions } from "@/utils/extractedQuestionMapper";

interface QuizCreationEntryProps {
  onManualCreate: () => void;
  onQuestionsLoaded?: (questions: Question[], title?: string) => void;
}

export function QuizCreationEntry({
  onManualCreate,
  onQuestionsLoaded,
}: QuizCreationEntryProps) {
  const [pastedText, setPastedText] = useState("");
  const [isParsingText, setIsParsingText] = useState(false);
  const toast = useToast();
  const { setDocument, setExtractionResult, setIsProcessing } = useExtractionStore();

  const handleParsePastedText = async () => {
    if (!pastedText.trim()) {
      toast.error("Vui lòng dán nội dung đề thi vào khung văn bản");
      return;
    }

    setIsParsingText(true);
    setIsProcessing(true, 30);

    try {
      const result = await extractQuizWithAI({
        text: pastedText,
      });

      setDocument({
        id: `paste-${Date.now().toString(36)}`,
        file: null,
        fileName: "Đề thi dán trực tiếp",
        fileType: "text",
        fileSize: pastedText.length,
        rawText: pastedText,
        uploadedAt: new Date().toISOString(),
      });

      setIsProcessing(true, 100);
      setExtractionResult(result);

      const mappedQuestions = mapExtractedQuestionsToQuizQuestions(result.questions);
      if (onQuestionsLoaded && mappedQuestions.length > 0) {
        onQuestionsLoaded(mappedQuestions, result.title || "Đề thi nhập từ văn bản");
        toast.success(`Đã nhận diện thành công ${mappedQuestions.length} câu hỏi!`);
      } else {
        toast.success(`Đã bóc tách thành công ${result.totalQuestionsDetected} câu hỏi từ văn bản!`);
      }
    } catch {
      toast.error("Có lỗi khi bóc tách văn bản. Vui lòng kiểm tra lại nội dung!");
    } finally {
      setIsParsingText(false);
      setIsProcessing(false, 0);
    }
  };

  const insertSampleText = () => {
    const sample = `Câu 1: Cho hàm số $f(x) = x^2 - 4x + 3$. Tọa độ đỉnh của parabol là:
A. $I(2; -1)$
B. $I(-2; 1)$
C. $I(1; 0)$
D. $I(3; 0)$
Đáp án: A

Câu 2: Tập nghiệm của phương trình $2^x = 8$ là:
A. $S = \\{2\\}$
B. $S = \\{3\\}$
C. $S = \\{4\\}$
D. $S = \\{8\\}$
Đáp án: B`;
    setPastedText(sample);
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="text-center space-y-2 mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
          Khởi tạo đề thi mới
        </h1>
        <p className="text-xs sm:text-sm text-neutral-500 max-w-xl mx-auto">
          Chọn phương thức tạo đề phù hợp: Tải tệp đề có sẵn (Word/PDF/Ảnh) hoặc tự soạn thảo thủ công / dán văn bản.
        </p>
      </div>

      {/* Task 3.1: 50/50 Split layout on large screens */}
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

        {/* RIGHT COLUMN: 50% Các chức năng khác (Tạo thủ công & Dán TXT) */}
        <div className="flex flex-col space-y-6">
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-900 pb-1 border-b border-neutral-200">
            <PenTool className="h-4 w-4 text-indigo-600" />
            <span>Các chức năng tạo đề khác</span>
          </div>

          {/* Option A: Tạo thủ công */}
          <Card
            hoverEffect
            className="border-neutral-200 bg-white cursor-pointer transition hover:border-blue-400 group"
            onClick={onManualCreate}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition">
                    <PenTool className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-neutral-900">
                      Tạo đề thi thủ công
                    </CardTitle>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Tự soạn từng câu hỏi với trình biên soạn công thức Toán KaTeX trực quan
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-neutral-400 group-hover:text-blue-600 group-hover:translate-x-1 transition" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                <span>Vào trình soạn thảo câu hỏi</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </CardContent>
          </Card>

          {/* Option B: Dán văn bản TXT / Thô */}
          <Card className="flex-1 flex flex-col border-neutral-200 bg-white">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                    <ClipboardPaste className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-neutral-900">
                      Dán văn bản TXT / Thô
                    </CardTitle>
                    <p className="text-[11px] text-neutral-500">
                      Dán nội dung trắc nghiệm thô, hệ thống tự tách câu hỏi & đáp án
                    </p>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={insertSampleText}
                  className="h-7 text-xs text-indigo-600"
                >
                  Chèn mẫu
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-4 space-y-3 flex-1 flex flex-col">
              <Textarea
                placeholder="Dán nội dung câu hỏi tại đây...&#10;Ví dụ:&#10;Câu 1: Nội dung câu hỏi...&#10;A. Đáp án A&#10;B. Đáp án B&#10;Đáp án: A"
                rows={6}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                className="font-mono text-xs flex-1 min-h-[140px]"
              />

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-neutral-400">
                  {pastedText.length > 0 ? `${pastedText.length} ký tự` : "Hỗ trợ định dạng KaTeX ($...$)"}
                </span>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleParsePastedText}
                  disabled={isParsingText || !pastedText.trim()}
                  isLoading={isParsingText}
                  leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                  className="font-semibold bg-indigo-600 hover:bg-indigo-700"
                >
                  Phân tích & Nhập đề
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
