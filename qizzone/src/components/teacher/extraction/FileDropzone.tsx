import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  UploadCloud,
  FileText,
  FileCode,
  Image as ImageIcon,
  Sparkles,
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
        handleFinishExtraction();
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
        handleFinishExtraction();
      } else if (isImage) {
        setIsProcessing(true, 40);
        // Đọc ảnh thành Base64 để xem trước & gọi AI Multimodal
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

  return (
    <div className="space-y-4">
      {/* File Dropzone Card */}
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
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 shadow-xs">
            <UploadCloud className="h-10 w-10 animate-pulse" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-xl font-extrabold text-neutral-900 tracking-tight">
              Kéo thả file đề thi hoặc Nhấn để tải lên
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
    </div>
  );
}

export default FileDropzone;
