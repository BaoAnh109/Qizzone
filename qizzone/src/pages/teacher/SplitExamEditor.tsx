import { useMemo } from "react";
import { FileDropzone } from "@/components/teacher/extraction/FileDropzone";
import { DocumentViewer } from "@/components/teacher/extraction/DocumentViewer";
import { ResizableSplitter } from "@/components/teacher/extraction/ResizableSplitter";
import { ExtractedQuestionCard } from "@/components/teacher/extraction/ExtractedQuestionCard";
import { BatchActionBar } from "@/components/teacher/extraction/BatchActionBar";
import { ReviewProgressPanel } from "@/components/teacher/extraction/ReviewProgressPanel";
import { useExtractionStore } from "@/store/extractionStore";
import { buildReviewDisplay } from "@/services/extraction/reviewDisplay";
import { buildSourceTraces } from "@/services/extraction/sourceTrace";
import { buildReviewProgress } from "@/services/extraction/reviewProgress";

export function SplitExamEditor() {
  const {
    extractionResult,
    hybridReview,
    splitterRatio,
    selectedQuestionId,
    filterStrategy,
    filterReviewStatus,
    searchQuery,
  } = useExtractionStore();

  // Bước 23: display model từ hybridReview (V2 + gate + evidence +
  // reconcile), key theo order hiển thị để truyền xuống từng card.
  // Bước 24: từ cùng hybridReview build thêm trace đối chiếu nguồn và
  // tiến trình thật (chunk + trạng thái câu + aiNeeded).
  const reviewDisplay = useMemo(() => {
    if (!hybridReview) return null;
    return buildReviewDisplay(hybridReview);
  }, [hybridReview]);

  const displayByOrder = useMemo(() => {
    if (!reviewDisplay) return null;
    return new Map(reviewDisplay.questions.map((d) => [d.order, d]));
  }, [reviewDisplay]);

  const traceByOrder = useMemo(() => {
    if (!hybridReview || !extractionResult) return null;
    return buildSourceTraces(hybridReview, extractionResult.questions);
  }, [hybridReview, extractionResult]);

  const reviewProgress = useMemo(() => {
    if (!hybridReview || !reviewDisplay) return null;
    return buildReviewProgress(hybridReview, reviewDisplay.summary);
  }, [hybridReview, reviewDisplay]);

  // Filter questions based on detection strategy, review status and search query
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

      // Bước 23: lọc theo trạng thái hiển thị. Khi chưa có hybridReview
      // thì không có dữ liệu phân loại nên bỏ qua bộ lọc này (không làm
      // rỗng danh sách vì thiếu dữ liệu).
      let matchesReviewStatus = true;
      if (filterReviewStatus !== "all" && displayByOrder) {
        matchesReviewStatus =
          displayByOrder.get(q.order)?.status === filterReviewStatus;
      }

      return matchesSearch && matchesStrategy && matchesReviewStatus;
    });
  }, [
    extractionResult,
    filterStrategy,
    filterReviewStatus,
    searchQuery,
    displayByOrder,
  ]);

  return (
    <div className="space-y-6 pb-16">
      {/* If no extraction result yet, show Dropzone view */}
      {!extractionResult ? (
        <div className="max-w-4xl mx-auto space-y-6 pt-4">
          <div className="text-center space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
              Nhập và kiểm tra đề thi từ tệp
            </h1>
            <p className="text-xs sm:text-sm text-neutral-500 max-w-xl mx-auto">
              Tải lên file Word (<strong className="text-neutral-700">.docx</strong>), PDF hoặc Ảnh chụp đề thi. Hệ thống tự động nhận diện câu hỏi, công thức Toán LaTeX và đáp án đúng.
            </p>
          </div>

          <FileDropzone />
        </div>
      ) : (
        /* Split-Screen 2-Column Editor */
        <div className="space-y-4">
          {/* Bước 24: tiến trình thật (chunk + trạng thái câu + OCR). */}
          {reviewProgress && <ReviewProgressPanel progress={reviewProgress} />}

          <BatchActionBar />

          <div className="flex h-[calc(100vh-210px)] min-h-[600px] flex-col gap-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100/50 md:flex-row">
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
              className="w-full md:h-full overflow-y-auto p-4 space-y-4 bg-neutral-50/50"
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
                    display={displayByOrder?.get(q.order)}
                    trace={traceByOrder?.get(q.order)}
                  />
                ))
              ) : (
                <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-12 text-center text-neutral-400">
                  <p className="text-sm font-bold text-neutral-800">
                    Không tìm thấy câu hỏi nào phù hợp với bộ lọc
                  </p>
                  <p className="text-xs text-neutral-500">
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
