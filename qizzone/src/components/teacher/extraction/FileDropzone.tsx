import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  UploadCloud,
  FileText,
  FileCode,
  Image as ImageIcon,
  Sparkles,
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

interface FileDropzoneProps {
  onSuccess?: () => void;
}

export function FileDropzone({ onSuccess }: FileDropzoneProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const {
    setDocument,
    setExtractionResult,
    isProcessing,
    processProgress,
    setIsProcessing,
  } = useExtractionStore();

  const [activeTab, setActiveTab] = useState<"file" | "paste">("file");
  const [pastedText, setPastedText] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFinishExtraction = () => {
    if (onSuccess) {
      onSuccess();
    } else {
      navigate("/teacher/extract-quiz");
    }
  };

  const processFile = async (file: File) => {
    const isDocx = file.name.endsWith(".docx");
    const isPdf = file.name.endsWith(".pdf");
    const isImage = /\.(png|jpe?g|webp)$/i.test(file.name);
    const isText = /\.(txt|md)$/i.test(file.name);

    if (!isDocx && !isPdf && !isImage && !isText) {
      toast.error("Vui lòng tải lên tệp định dạng .docx, .pdf, ảnh chụp hoặc .txt/.md!");
      return;
    }

    setIsProcessing(true, 20);

    try {
      if (isDocx) {
        setIsProcessing(true, 50);
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
        handleFinishExtraction();
      } else if (isPdf) {
        setIsProcessing(true, 50);
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
        handleFinishExtraction();
      } else if (isImage) {
        setIsProcessing(true, 40);
        const reader = new FileReader();
        reader.onload = async () => {
          try {
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
            handleFinishExtraction();
          } catch {
            toast.error("Không thể phân tích ảnh đề thi. Vui lòng kiểm tra lại chất lượng ảnh!");
          } finally {
            setIsProcessing(false, 0);
          }
        };
        reader.readAsDataURL(file);
        return;
      } else {
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
        handleFinishExtraction();
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
      toast.error("Vui lòng dán nội dung văn bản đề thi!");
      return;
    }

    setIsProcessing(true, 30);
    try {
      const result = await extractQuizWithAI({
        text: pastedText,
      });

      setDocument({
        id: `doc-${Date.now().toString(36)}`,
        file: new File([pastedText], "de-thi-nhap-van-ban.txt", { type: "text/plain" }),
        fileName: "Đề thi nhập văn bản trực tiếp",
        fileType: "text",
        fileSize: new Blob([pastedText]).size,
        rawText: pastedText,
        uploadedAt: new Date().toISOString(),
      });

      setIsProcessing(true, 100);
      setExtractionResult(result);
      toast.success(
        `Đã bóc tách thành công ${result.totalQuestionsDetected} câu hỏi từ văn bản!`
      );
      handleFinishExtraction();
    } catch {
      toast.error("Không thể bóc tách nội dung văn bản. Vui lòng thử lại!");
    } finally {
      setIsProcessing(false, 0);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* 2 Tabs Switcher: Thả file & Nhập text */}
      <div className="flex items-center gap-1 rounded-xl bg-neutral-100 p-1 border border-neutral-200/80">
        <button
          type="button"
          onClick={() => setActiveTab("file")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === "file"
              ? "bg-white text-indigo-700 shadow-2xs"
              : "text-neutral-500 hover:text-neutral-800"
          }`}
        >
          <UploadCloud className="h-3.5 w-3.5" />
          <span>Tải tệp đề thi (Word / PDF / Ảnh)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("paste")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === "paste"
              ? "bg-white text-indigo-700 shadow-2xs"
              : "text-neutral-500 hover:text-neutral-800"
          }`}
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          <span>Dán văn bản thô / TXT</span>
        </button>
      </div>

      {/* Tab 1: Kéo thả tệp file (Chiều cao tối ưu, chừa chỗ cho loading) */}
      {activeTab === "file" ? (
        <Card
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`flex-1 flex flex-col justify-center items-center border-2 border-dashed p-5 sm:p-6 text-center transition cursor-pointer min-h-[295px] ${
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

          <div className="max-w-md mx-auto space-y-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700 shadow-xs">
              <UploadCloud className="h-7 w-7 animate-pulse" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-extrabold text-neutral-900 tracking-tight">
                Kéo thả file đề thi hoặc Nhấn để tải lên
              </h3>
              <p className="text-xs text-neutral-500">
                Hỗ trợ Word (<strong className="text-neutral-700">.docx</strong>), PDF (<strong className="text-neutral-700">.pdf</strong>), Ảnh chụp (<strong className="text-neutral-700">.png, .jpg</strong>).
              </p>
            </div>

            {/* Formats Pills */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-[11px] font-semibold text-neutral-600">
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-blue-700 border border-blue-200/60">
                <FileText className="h-3 w-3" /> Word .docx
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-rose-700 border border-rose-200/60">
                <FileCode className="h-3 w-3" /> PDF thật
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700 border border-emerald-200/60">
                <ImageIcon className="h-3 w-3" /> Ảnh chụp (AI Vision)
              </span>
            </div>

            <div className="pt-1.5">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                className="shadow-sm font-bold pointer-events-none"
              >
                Chọn tệp từ máy tính
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        /* Tab 2: Dán văn bản thô / TXT */
        <Card className="flex-1 flex flex-col justify-between p-4 sm:p-5 bg-white border-neutral-200 shadow-xs min-h-[295px] space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-neutral-900 font-bold">
              <ClipboardPaste className="h-4 w-4 text-indigo-600" />
              <span>Dán toàn bộ nội dung đề thi vào khung:</span>
            </div>
            <span className="text-[11px] text-neutral-400">Hỗ trợ KaTeX $...$</span>
          </div>

          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={`Câu 1: Giá trị của \\lim_{x \\to 1} (2x^2 - 3x + 1) bằng:
A. 0
B. 1
C. -1
D. 2
Lời giải: Thay x = 1 vào biểu thức ta được 2(1) - 3(1) + 1 = 0. Chọn A.

BẢNG ĐÁP ÁN:
1.A  2.B`}
            className="w-full flex-1 min-h-[155px] rounded-xl border border-neutral-300 p-3 text-xs font-mono leading-relaxed text-neutral-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-hidden resize-none"
          />

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-neutral-500">
              Độ dài: <strong>{pastedText.length} ký tự</strong>
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePasteProcess}
              disabled={!pastedText.trim() || isProcessing}
              leftIcon={<Sparkles className="h-3.5 w-3.5" />}
              rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
              className="font-bold bg-indigo-600 hover:bg-indigo-700 shadow-sm"
            >
              Bóc tách đề thi ngay
            </Button>
          </div>
        </Card>
      )}

      {/* Progress Loading Bar (Hiển thị ngay dưới card, bố cục vừa vặn gọn gàng) */}
      {isProcessing && (
        <Card className="p-3 bg-indigo-50 border-indigo-200 space-y-1.5 animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 animate-spin" />
              <span>Hệ thống đang bóc tách câu hỏi, công thức Toán LaTeX và nhận diện đáp án...</span>
            </span>
            <span>{processProgress}%</span>
          </div>
          <div className="w-full bg-indigo-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${processProgress}%` }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

export default FileDropzone;
