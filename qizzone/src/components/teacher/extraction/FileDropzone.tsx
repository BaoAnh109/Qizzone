import { useState, useRef } from "react";
import {
  UploadCloud,
  FileText,
  FileCode,
  Image as ImageIcon,
  Sparkles,
  Zap,
  CheckCircle2,
  ClipboardPaste,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/hooks/useToast";
import { parseDocxFile } from "@/utils/parsers/docxParser";
import { parsePdfFile } from "@/utils/parsers/pdfParser";
import { extractQuizWithAI } from "@/services/aiExtractionService";
import { useExtractionStore } from "@/store/extractionStore";

export function FileDropzone() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const {
    setDocument,
    setExtractionResult,
    isProcessing,
    processProgress,
    setIsProcessing,
  } = useExtractionStore();

  const [activeTab, setActiveTab] = useState<"upload" | "paste">("upload");
  const [isDragOver, setIsDragOver] = useState(false);
  const [pastedText, setPastedText] = useState("");

  const processFile = async (file: File) => {
    const isDocx = file.name.endsWith(".docx");
    const isPdf = file.name.endsWith(".pdf");
    const isImage = /\.(png|jpe?g|webp)$/i.test(file.name);
    const isText = /\.(txt|md)$/i.test(file.name);

    if (!isDocx && !isPdf && !isImage && !isText) {
      toast.error("Vui lòng chọn file định dạng .docx, .pdf, .png, .jpg hoặc .txt");
      return;
    }

    if (file.size > 30 * 1024 * 1024) {
      toast.error("Dung lượng file vượt quá giới hạn 30MB");
      return;
    }

    setIsProcessing(true, 20);

    try {
      if (isDocx) {
        setIsProcessing(true, 50);
        // Bóc tách Word (.docx) bảo toàn định dạng gạch chân, in đậm, màu sắc
        const { rawHtml, rawText, result } = await parseDocxFile(file);
        setDocument({
          id: `doc-${Date.now().toString(36)}`,
          file,
          fileName: file.name,
          fileType: "docx",
          fileSize: file.size,
          rawHtml,
          rawText,
          uploadedAt: new Date().toISOString(),
        });
        setIsProcessing(true, 100);
        setExtractionResult(result);
        toast.success(
          `Đã bóc tách thành công ${result.totalQuestionsDetected} câu hỏi từ file Word!`
        );
      } else if (isPdf) {
        setIsProcessing(true, 50);
        // Bóc tách PDF thật bằng PDF.js
        const { rawText, totalPages, result, pdfDoc } = await parsePdfFile(file);
        setDocument({
          id: `doc-${Date.now().toString(36)}`,
          file,
          fileName: file.name,
          fileType: "pdf",
          fileSize: file.size,
          rawText,
          totalPages,
          pdfDoc,
          uploadedAt: new Date().toISOString(),
        });
        setIsProcessing(true, 100);
        setExtractionResult(result);
        toast.success(
          `Đã bóc tách thành công ${result.totalQuestionsDetected} câu hỏi từ PDF (${totalPages} trang)!`
        );
      } else if (isImage) {
        setIsProcessing(true, 40);
        // Đọc ảnh thành Base64 để xem trước & gọi AI Multimodal
        const reader = new FileReader();
        reader.onload = async () => {
          const imageBase64 = reader.result as string;
          setDocument({
            id: `doc-${Date.now().toString(36)}`,
            file,
            fileName: file.name,
            fileType: "image",
            fileSize: file.size,
            previewUrl: imageBase64,
            imageBase64,
            uploadedAt: new Date().toISOString(),
          });

          setIsProcessing(true, 70);
          const result = await extractQuizWithAI({ file, imageBase64 });
          setIsProcessing(true, 100);
          setExtractionResult(result);
          toast.success(
            `AI đã phân tích ảnh và trích xuất ${result.totalQuestionsDetected} câu hỏi!`
          );
        };
        reader.readAsDataURL(file);
      } else {
        // File văn bản .txt/.md
        const text = await file.text();
        const result = await extractQuizWithAI({
          file,
          text,
        });
        setDocument({
          id: `doc-${Date.now().toString(36)}`,
          file,
          fileName: file.name,
          fileType: "text",
          fileSize: file.size,
          rawText: text,
          uploadedAt: new Date().toISOString(),
        });
        setIsProcessing(true, 100);
        setExtractionResult(result);
        toast.success(
          `Đã bóc tách thành công ${result.totalQuestionsDetected} câu hỏi từ tệp văn bản!`
        );
      }
    } catch {
      toast.error("Không thể phân tích tệp đề thi. Vui lòng kiểm tra lại cấu trúc file!");
    } finally {
      setIsProcessing(false, 0);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handlePasteProcess = async () => {
    if (!pastedText.trim()) {
      toast.error("Vui lòng dán nội dung đề thi vào khung văn bản");
      return;
    }

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
      toast.success(
        `Đã bóc tách thành công ${result.totalQuestionsDetected} câu hỏi từ văn bản!`
      );
    } catch {
      toast.error("Có lỗi khi bóc tách văn bản. Vui lòng kiểm tra lại nội dung!");
    } finally {
      setIsProcessing(false, 0);
    }
  };

  const handleSelectSample = async (
    sampleType: "docx_underline" | "docx_table" | "ai_math"
  ) => {
    setIsProcessing(true, 30);
    let sampleText: string;
    let fileName: string;

    if (sampleType === "docx_underline") {
      fileName = "De_Kiem_Tra_Toan12_GachChan.docx";
      sampleText = `
Câu 1: Cho hàm số $f(x) = x^3 - 3x + 2$. Điểm cực đại của đồ thị hàm số là:
<u>A. $M(-1; 4)$</u>
B. $N(1; 0)$
C. $P(0; 2)$
D. $Q(2; 4)$
Lời giải: Ta có $f'(x) = 3x^2 - 3 = 0 \\Leftrightarrow x = \\pm 1$. Điểm cực đại là $M(-1; 4)$.

Câu 2: Nguyên hàm $\\int (2x + 1) dx$ bằng:
A. $x^2 + x$
<u>B. $x^2 + x + C$</u>
C. $2x^2 + x + C$
D. $x^2 + C$

Câu 3: Bất phương trình $\\log_2(x - 1) \\le 3$ có tập nghiệm là:
A. $(1; 8]$
<u>B. $(1; 9]$</u>
C. $(-\\infty; 9]$
D. $[1; 9]$

Câu 4: Thể tích khối lăng trụ có diện tích đáy $B = 4$ và chiều cao $h = 3$ là:
A. $V = 4$
B. $V = 6$
<u>C. $V = 12$</u>
D. $V = 36$
`;
    } else if (sampleType === "docx_table") {
      fileName = "De_Thi_Thu_Toan_BangDapAn.docx";
      sampleText = `
Câu 1: Giá trị của $\\lim_{x \\to 1} (2x^2 - 3x + 1)$ bằng:
A. 0
B. 1
C. -1
D. 2

Câu 2: Trong không gian $Oxyz$, mặt cầu $(S): x^2 + y^2 + z^2 - 4x = 0$ có bán kính bằng:
A. 4
B. 2
C. 16
D. $\\sqrt{2}$

Câu 3: Số phức $z = 3 - 4i$ có môđun bằng:
A. 7
B. 1
C. 5
D. 25

BẢNG ĐÁP ÁN:
1.A  2.B  3.C
`;
    } else {
      fileName = "De_Thi_Anh_Scan_AI_Giai.png";
      sampleText = `
Câu 1: Phương trình $\\sin x = \\frac{1}{2}$ có nghiệm là:
A. $x = \\frac{\\pi}{6} + k2\\pi$
B. $x = \\frac{\\pi}{3} + k2\\pi$
C. $x = \\frac{\\pi}{4} + k2\\pi$
D. $x = \\pi + k2\\pi$

Câu 2: Cho cấp số cộng $(u_n)$ có $u_1 = 3, d = 2$. Tính $u_5$:
A. $u_5 = 11$
B. $u_5 = 10$
C. $u_5 = 13$
D. $u_5 = 15$
`;
    }

    const result = await extractQuizWithAI({
      text: sampleText,
      file: undefined,
    });

    setDocument({
      id: `sample-${Date.now().toString(36)}`,
      file: null,
      fileName,
      fileType: "docx",
      fileSize: sampleText.length,
      rawText: sampleText,
      uploadedAt: new Date().toISOString(),
    });

    setIsProcessing(true, 100);
    setExtractionResult(result);
    setIsProcessing(false, 0);
    toast.success(`Đã nạp đề mẫu và bóc tách ${result.totalQuestionsDetected} câu hỏi!`);
  };

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-xl bg-neutral-100 p-1 border border-neutral-200 shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === "upload"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            <UploadCloud className="h-4 w-4" />
            <span>Tải lên tệp đề thi (.docx, .pdf, ảnh)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("paste")}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === "paste"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            <ClipboardPaste className="h-4 w-4" />
            <span>Dán văn bản trực tiếp (Paste Text)</span>
          </button>
        </div>
      </div>

      {/* Tab 1: File Dropzone */}
      {activeTab === "upload" ? (
        <Card
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed p-8 sm:p-12 text-center transition cursor-pointer ${
            isDragOver
              ? "border-indigo-600 bg-indigo-50/50 scale-[1.01]"
              : "border-neutral-300 hover:border-indigo-400 bg-neutral-50/40"
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf,.png,.jpg,.jpeg,.txt,.md"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                processFile(e.target.files[0]);
              }
            }}
          />

          <div className="max-w-md mx-auto space-y-4">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-100/80 text-indigo-700 shadow-inner">
              <UploadCloud className="h-10 w-10 animate-pulse" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xl font-extrabold text-neutral-900 tracking-tight">
                Kéo thả file đề thi thật hoặc Nhấn để tải lên
              </h3>
              <p className="text-xs sm:text-sm text-neutral-500">
                Hỗ trợ Word (<strong className="text-neutral-700">.docx</strong>), PDF (<strong className="text-neutral-700">.pdf</strong>), Ảnh chụp (<strong className="text-neutral-700">.png, .jpg</strong>).
              </p>
            </div>

            {/* Formats Pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-[11px] font-semibold text-neutral-600">
              <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-blue-700 border border-blue-200/60">
                <FileText className="h-3.5 w-3.5" /> Word .docx (Gạch chân / In đậm / Highlight / Bảng)
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-rose-700 border border-rose-200/60">
                <FileCode className="h-3.5 w-3.5" /> PDF thật (Text & Bảng đáp án cuối)
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700 border border-emerald-200/60">
                <ImageIcon className="h-3.5 w-3.5" /> Ảnh chụp (AI Vision & KaTeX)
              </span>
            </div>

            <div className="pt-2">
              <Button
                variant="primary"
                size="md"
                leftIcon={<Sparkles className="h-4 w-4" />}
                className="shadow-sm font-bold pointer-events-none"
              >
                Chọn tệp từ máy tính
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        /* Tab 2: Direct Paste Text Area */
        <Card className="p-6 bg-white border-neutral-200 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5 text-indigo-600" />
              <h3 className="text-sm font-bold text-neutral-900">
                Dán toàn bộ nội dung đề thi vào khung bên dưới:
              </h3>
            </div>
            <span className="text-xs text-neutral-400">Hỗ trợ công thức $...$ KaTeX</span>
          </div>

          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={`Dán đề thi của bạn vào đây. Ví dụ:

Câu 1: Giá trị của \\lim_{x \\to 1} (2x^2 - 3x + 1) bằng:
A. 0
B. 1
C. -1
D. 2
Lời giải: Thay x = 1 vào biểu thức ta được 2(1) - 3(1) + 1 = 0. Chọn A.

Câu 2: Cho hàm số y = f(x)...
*A. Đồng biến trên (0; 2)
B. Nghịch biến trên (0; 2)
C. Đồng biến trên R
D. Nghịch biến trên R

BẢNG ĐÁP ÁN:
1.A  2.A`}
            rows={10}
            className="w-full rounded-xl border border-neutral-300 p-4 text-xs font-mono leading-relaxed text-neutral-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-hidden"
          />

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-neutral-500">
              Độ dài: <strong>{pastedText.length} ký tự</strong>
            </span>
            <Button
              variant="primary"
              size="md"
              onClick={handlePasteProcess}
              disabled={!pastedText.trim() || isProcessing}
              leftIcon={<Sparkles className="h-4 w-4" />}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="font-bold bg-indigo-600 hover:bg-indigo-700 shadow-sm"
            >
              Bóc tách đề thi ngay
            </Button>
          </div>
        </Card>
      )}

      {/* Progress Indicator */}
      {isProcessing && (
        <Card className="p-4 bg-indigo-50 border-indigo-200 space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600 animate-spin" />
              <span>Hệ thống đang bóc tách câu hỏi, công thức Toán LaTeX và nhận diện đáp án...</span>
            </span>
            <span>{processProgress}%</span>
          </div>
          <div className="w-full bg-indigo-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${processProgress}%` }}
            />
          </div>
        </Card>
      )}

      {/* 1-Click Sample Demos */}
      <div className="rounded-2xl bg-white p-5 border border-neutral-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-700 uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-500 fill-current" />
            <span>Thử nghiệm nhanh với các mẫu đề thực tế:</span>
          </span>
          <span className="text-[11px] text-neutral-400">1-Click nạp ngay</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => handleSelectSample("docx_underline")}
            className="flex flex-col text-left p-3.5 rounded-xl border border-neutral-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition cursor-pointer space-y-1"
          >
            <div className="flex items-center justify-between text-xs font-bold text-neutral-900">
              <span>Mẫu Word: Gạch chân <u>A.</u></span>
              <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />
            </div>
            <p className="text-[11px] text-neutral-500">
              Đáp án đúng được gạch dưới <u>A.</u> và có phần lời giải chi tiết.
            </p>
          </button>

          <button
            type="button"
            onClick={() => handleSelectSample("docx_table")}
            className="flex flex-col text-left p-3.5 rounded-xl border border-neutral-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition cursor-pointer space-y-1"
          >
            <div className="flex items-center justify-between text-xs font-bold text-neutral-900">
              <span>Mẫu: Bảng đáp án cuối</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <p className="text-[11px] text-neutral-500">
              Đề thi có ma trận bảng đáp án: 1.A 2.B 3.C ở trang cuối đề.
            </p>
          </button>

          <button
            type="button"
            onClick={() => handleSelectSample("ai_math")}
            className="flex flex-col text-left p-3.5 rounded-xl border border-neutral-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition cursor-pointer space-y-1"
          >
            <div className="flex items-center justify-between text-xs font-bold text-neutral-900">
              <span>Mẫu: AI Tự suy luận giải</span>
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <p className="text-[11px] text-neutral-500">
              Đề bài không có đáp án, AI Gemini tự động giải phương trình và chọn đáp án.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}

export default FileDropzone;
