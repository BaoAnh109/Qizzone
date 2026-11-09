import { useMemo } from "react";
import { FileDropzone } from "@/components/teacher/extraction/FileDropzone";
import { DocumentViewer } from "@/components/teacher/extraction/DocumentViewer";
import { ResizableSplitter } from "@/components/teacher/extraction/ResizableSplitter";
import { ExtractedQuestionCard } from "@/components/teacher/extraction/ExtractedQuestionCard";
import { BatchActionBar } from "@/components/teacher/extraction/BatchActionBar";
import { useExtractionStore } from "@/store/extractionStore";

export function SplitExamEditor() {
  const {
    extractionResult,
    splitterRatio,
    selectedQuestionId,
    filterStrategy,
    searchQuery,
  } = useExtractionStore();

  // Filter questions based on detection strategy and search query
  const filteredQuestions = useMemo(() => {
    if (!extractionResult) return [];

    return extractionResult.questions.filter((q) => {
      const matchesSearch =
        q.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        q.options.some((o) =>
          o.content.toLowerCase().includes(searchQuery.toLowerCase())
        );

      let matchesStrategy = true;
      if (filterStrategy === "warnings") {
        matchesStrategy = !!(q.warningFlags && q.warningFlags.length > 0);
      } else if (filterStrategy !== "all") {
        matchesStrategy = q.detectionStrategy === filterStrategy;
      }

      return matchesSearch && matchesStrategy;
    });
  }, [extractionResult, filterStrategy, searchQuery]);

  return (
    <div className="space-y-6 pb-16">
      {/* If no extraction result yet, show Dropzone view */}
      {!extractionResult ? (
        <div className="max-w-4xl mx-auto space-y-6 pt-4">
          <div className="text-center space-y-2">
            <h1 className="page-heading">
              Nhập và kiểm tra đề thi từ tệp
            </h1>
            <p className="text-xs sm:text-sm theme-text-muted max-w-xl mx-auto">
              Tải lên file Word (<strong className="theme-text-secondary">.docx</strong>), PDF hoặc Ảnh chụp đề thi. Hệ thống tự động nhận diện câu hỏi, công thức Toán LaTeX và đáp án đúng.
            </p>
          </div>

          <FileDropzone />
        </div>
      ) : (
        /* Split-Screen 2-Column Editor */
        <div className="space-y-4">
          <BatchActionBar />

          <div className="flex h-[calc(100vh-210px)] min-h-[600px] flex-col gap-0 overflow-hidden rounded-lg border theme-border theme-surface-muted md:flex-row">
            {/* Left Column: Document Viewer */}
            <div
              className="w-full md:h-full overflow-hidden"
              style={{
                width:
                  typeof window !== "undefined" && window.innerWidth >= 768
                    ? `${splitterRatio}%`
                    : "100%",
              }}
            >
              <DocumentViewer />
            </div>

            {/* Middle Draggable Splitter */}
            <ResizableSplitter />

            {/* Right Column: Extracted Questions List */}
            <div
              className="w-full md:h-full overflow-y-auto p-4 space-y-4 theme-surface-muted"
              style={{
                width:
                  typeof window !== "undefined" && window.innerWidth >= 768
                    ? `${100 - splitterRatio}%`
                    : "100%",
              }}
            >
              {filteredQuestions.length > 0 ? (
                filteredQuestions.map((q) => (
                  <ExtractedQuestionCard
                    key={q.id}
                    question={q}
                    isSelected={q.id === selectedQuestionId}
                  />
                ))
              ) : (
                <div className="space-y-2 rounded-lg border theme-border theme-surface p-12 text-center theme-text-muted">
                  <p className="text-sm font-bold theme-text-secondary">
                    Không tìm thấy câu hỏi nào phù hợp với bộ lọc
                  </p>
                  <p className="text-xs theme-text-muted">
                    Thử chọn lại bộ lọc nguồn nhận diện hoặc xóa từ khóa tìm kiếm.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SplitExamEditor;
