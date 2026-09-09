import { useState, useRef, useEffect } from "react";
import {
  ZoomIn,
  ZoomOut,
  FileText,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  RotateCw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useExtractionStore } from "@/store/extractionStore";
import { useToast } from "@/hooks/useToast";
import { renderPdfPageToCanvas } from "@/utils/parsers/pdfParser";

export function DocumentViewer() {
  const { document, extractionResult, selectedQuestionId } = useExtractionStore();
  const toast = useToast();

  const [zoomLevel, setZoomLevel] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCopied, setIsCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [rotation, setRotation] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const totalPages = document?.totalPages || 1;

  // Render PDF page onto canvas whenever page or zoom changes
  useEffect(() => {
    if (document?.fileType === "pdf" && document.pdfDoc && canvasRef.current) {
      renderPdfPageToCanvas(
        document.pdfDoc,
        currentPage,
        canvasRef.current,
        (zoomLevel / 100) * 1.5
      ).catch(() => {
        // Fallback silently if canvas rendering was interrupted
      });
    }
  }, [document, currentPage, zoomLevel, rotation]);

  if (!document && !extractionResult) {
    return (
      <Card className="h-full flex items-center justify-center p-8 text-center bg-neutral-50/60 border-neutral-200">
        <div className="space-y-2 text-neutral-400">
          <FileText className="h-10 w-10 mx-auto stroke-1" />
          <p className="text-sm font-medium">Chưa có tài liệu nguồn nào được tải lên</p>
        </div>
      </Card>
    );
  }

  const handleCopyRaw = () => {
    const textToCopy = document?.rawText || "";
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      toast.success("Đã sao chép toàn bộ văn bản gốc của đề thi!");
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const selectedQuestion = extractionResult?.questions.find(
    (q) => q.id === selectedQuestionId
  );

  return (
    <Card
      className={`flex flex-col h-full overflow-hidden border-neutral-200/90 shadow-xs transition-all ${
        isExpanded ? "fixed inset-4 z-50 shadow-2xl bg-white" : ""
      }`}
    >
      {/* Header Toolbar */}
      <CardHeader className="py-3 px-4 bg-neutral-50/90 border-b border-neutral-200 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" size="sm" className="font-mono text-xs uppercase">
            {document?.fileType || "DOCX"}
          </Badge>
          <CardTitle className="text-xs sm:text-sm font-bold truncate text-neutral-800">
            {document?.fileName || "Tài liệu đề thi gốc"}
          </CardTitle>
        </div>

        <div className="flex items-center gap-1.5">
          {/* PDF Page Navigation */}
          {document?.fileType === "pdf" && totalPages > 1 && (
            <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-lg border border-neutral-200 text-xs font-semibold mr-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-[11px] text-neutral-700 min-w-14 text-center">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Zoom controls */}
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-200 transition cursor-pointer"
            title="Thu nhỏ"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="font-mono text-xs text-neutral-600 w-9 text-center">
            {zoomLevel}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(200, z + 10))}
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-200 transition cursor-pointer"
            title="Phóng to"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          {/* Rotate Image */}
          {document?.fileType === "image" && (
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-200 transition cursor-pointer"
              title="Xoay ảnh 90°"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          )}

          <span className="h-4 w-px bg-neutral-300 mx-1" />

          <button
            type="button"
            onClick={handleCopyRaw}
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-200 transition cursor-pointer"
            title="Sao chép toàn bộ văn bản gốc"
          >
            {isCopied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-200 transition cursor-pointer"
            title={isExpanded ? "Thu nhỏ lại" : "Mở rộng toàn màn hình"}
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </CardHeader>

      {/* Document Content View */}
      <CardContent className="p-0 flex-1 overflow-y-auto bg-neutral-100/70 font-sans">
        <div className="p-4 sm:p-6 transition-all origin-top">
          {/* Active Highlight Target Banner */}
          {selectedQuestion && (
            <div className="mb-4 rounded-xl bg-indigo-50 p-3 border border-indigo-200 text-xs text-indigo-950 flex items-center justify-between shadow-2xs">
              <span className="flex items-center gap-1.5 font-bold">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <span>Đang đồng bộ xem câu {selectedQuestion.order}:</span>
              </span>
              <span className="font-mono text-[11px] text-indigo-700 bg-white px-2 py-0.5 rounded-md border border-indigo-100">
                Đáp án: {selectedQuestion.correctAnswers.join(", ")} ({selectedQuestion.detectionStrategy})
              </span>
            </div>
          )}

          {/* Render PDF Canvas */}
          {document?.fileType === "pdf" && document.pdfDoc ? (
            <div className="flex flex-col items-center justify-center p-2">
              <div className="rounded-xl shadow-lg border border-neutral-300 bg-white overflow-hidden max-w-full">
                <canvas ref={canvasRef} className="max-w-full h-auto block" />
              </div>
            </div>
          ) : document?.fileType === "image" && (document.imageBase64 || document.previewUrl) ? (
            /* Render Image Viewer */
            <div className="flex flex-col items-center justify-center p-2">
              <div
                className="overflow-hidden rounded-lg border border-neutral-200 bg-white p-2"
                style={{
                  transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`,
                }}
              >
                <img
                  src={document.imageBase64 || document.previewUrl}
                  alt={document.fileName}
                  className="max-w-full h-auto rounded-xl object-contain"
                />
              </div>
            </div>
          ) : (
            /* Render Word / Text Document */
            <div
              className="min-h-[500px] rounded-lg border border-neutral-200 bg-white p-6 font-sans text-sm leading-relaxed text-neutral-800 sm:p-8"
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left" }}
            >
              {document?.rawHtml ? (
                <div
                  className="prose prose-sm max-w-none [&_u]:underline [&_u]:decoration-indigo-600 [&_u]:decoration-2 [&_strong]:text-indigo-950 [&_mark]:bg-yellow-200 [&_.text-color-red]:text-rose-600 [&_table]:border-collapse [&_table]:border [&_table]:border-neutral-300 [&_td]:border [&_td]:border-neutral-300 [&_td]:p-2 [&_th]:border [&_th]:border-neutral-300 [&_th]:p-2"
                  dangerouslySetInnerHTML={{ __html: document.rawHtml }}
                />
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800 leading-relaxed">
                  {document?.rawText || "Nội dung văn bản đề thi"}
                </pre>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default DocumentViewer;
