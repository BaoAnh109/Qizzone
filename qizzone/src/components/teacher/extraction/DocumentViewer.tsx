import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import DOMPurify from "dompurify";
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
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useExtractionStore } from "@/store/extractionStore";
import { useToast } from "@/hooks/useToast";
import { renderPdfPageToCanvas } from "@/utils/parsers/pdfParser";
import type { DocumentIRBlock } from "@/types/documentIR";

interface PageSize {
  width: number;
  height: number;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function getVisualSourceId(block: DocumentIRBlock, fileType?: string): string {
  if (fileType === "docx" && block.sourceRef.paragraph !== undefined) {
    return `docx_paragraph_${block.sourceRef.paragraph}`;
  }
  return block.id;
}

function tagSanitizedDocxHtml(cleanHtml: string, flowBlocks: DocumentIRBlock[]): string {
  if (typeof DOMParser === "undefined") return cleanHtml;

  const parsed = new DOMParser().parseFromString(cleanHtml, "text/html");
  if (!parsed.body.querySelector("[data-source-id]")) {
    const blocks = flowBlocks.filter((block) => block.type === "paragraph" || block.type === "list_item");
    const nodes = Array.from(parsed.body.querySelectorAll<HTMLElement>("p, li, tr, h1, h2, h3, h4, blockquote"));
    let nextBlock = 0;
    nodes.forEach((node) => {
      const nodeText = normalizeText(node.textContent || "");
      if (!nodeText) return;
      let matchIndex = blocks.findIndex((block, index) => index >= nextBlock && normalizeText(block.text || "") === nodeText);
      if (matchIndex < 0) {
        matchIndex = blocks.findIndex((block, index) => index >= nextBlock && normalizeText(block.text || "").includes(nodeText));
      }
      if (matchIndex < 0) return;
      node.dataset.sourceId = blocks[matchIndex].id;
      nextBlock = matchIndex + 1;
    });
  }
  return parsed.body.innerHTML;
}

export function DocumentViewer() {
  const {
    document,
    extractionResult,
    selectedQuestionId,
    setSelectedQuestionId,
  } = useExtractionStore();
  const toast = useToast();
  const [zoomLevel, setZoomLevel] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCopied, setIsCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [pdfPageSizes, setPdfPageSizes] = useState<Record<number, PageSize>>({});
  const [renderedPdfPages, setRenderedPdfPages] = useState<Set<number>>(() => new Set([1, 2]));

  const documentContentRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const selectionFocusPendingRef = useRef<string | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  const questions = useMemo(() => extractionResult?.questions || [], [extractionResult?.questions]);
  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId);
  const selectedSourceRefs = useMemo(() => selectedQuestion?.sourceRefs || [], [selectedQuestion?.sourceRefs]);
  const selectedSourceRefSet = useMemo(() => new Set(selectedSourceRefs), [selectedSourceRefs]);
  const allBlocks = useMemo(
    () => [...(document?.documentIR?.pages.flatMap((page) => page.blocks) || []), ...(document?.documentIR?.flowBlocks || [])],
    [document?.documentIR],
  );
  const blockById = useMemo(() => new Map(allBlocks.map((block) => [block.id, block])), [allBlocks]);
  const questionByVisualSourceId = useMemo(() => {
    const sources = new Map<string, string>();
    questions.forEach((question) => {
      const refs = new Set([
        ...(question.sourceRefs || []),
        ...(question.promptSourceRefs || []),
        ...question.options.flatMap((option) => option.sourceRefs || []),
      ]);
      refs.forEach((ref) => {
        const block = blockById.get(ref);
        if (!sources.has(ref)) sources.set(ref, question.id);
        const visualId = block ? getVisualSourceId(block, document?.fileType) : ref;
        if (!sources.has(visualId)) sources.set(visualId, question.id);
      });
    });
    return sources;
  }, [questions, blockById, document?.fileType]);
  const selectedVisualSourceIds = useMemo(() => {
    const ids = new Set<string>();
    selectedSourceRefs.forEach((ref) => {
      const block = blockById.get(ref);
      ids.add(block ? getVisualSourceId(block, document?.fileType) : ref);
    });
    return ids;
  }, [selectedSourceRefs, blockById, document?.fileType]);
  const sanitizedRawHtml = useMemo(() => {
    if (!document?.rawHtml) return "";
    return tagSanitizedDocxHtml(DOMPurify.sanitize(document.rawHtml), document.documentIR?.flowBlocks || []);
  }, [document]);
  const totalPages = document?.totalPages || document?.pdfDoc?.numPages || document?.documentIR?.pages.length || 1;
  const currentPageIR = document?.documentIR?.pages.find((page) => page.pageNumber === currentPage);

  useEffect(() => {
    if (document?.fileType !== "pdf" || !document.pdfDoc) return;
    let cancelled = false;
    const loadSizes = async () => {
      const entries = await Promise.all(Array.from({ length: totalPages }, async (_, index) => {
        const pageNumber = index + 1;
        try {
          const page = await document.pdfDoc.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          return [pageNumber, { width: viewport.width, height: viewport.height }] as const;
        } catch {
          return [pageNumber, { width: 595, height: 842 }] as const;
        }
      }));
      const sizes = Object.fromEntries(entries);
      if (!cancelled) setPdfPageSizes(sizes);
    };
    void loadSizes();
    return () => { cancelled = true; };
  }, [document, totalPages]);

  useEffect(() => {
    if (document?.fileType !== "pdf" || !document.pdfDoc || !documentContentRef.current || typeof IntersectionObserver === "undefined") return;
    const root = documentContentRef.current;
    const pageNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-page]"));
    if (!pageNodes.length) return;

    const observer = new IntersectionObserver((entries) => {
      const visiblePages = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => Number((entry.target as HTMLElement).dataset.pdfPage))
        .filter(Number.isFinite);
      if (!visiblePages.length) return;

      const nearby = new Set<number>();
      visiblePages.forEach((page) => {
        nearby.add(page);
        if (page > 1) nearby.add(page - 1);
        if (page < totalPages) nearby.add(page + 1);
      });
      setRenderedPdfPages(nearby);

      const rootCenter = root.getBoundingClientRect().top + root.clientHeight / 2;
      const nearestPage = pageNodes.reduce((nearest, node) => {
        const bounds = node.getBoundingClientRect();
        const center = (bounds.top + bounds.bottom) / 2;
        const page = Number(node.dataset.pdfPage);
        return Math.abs(center - rootCenter) < Math.abs(nearest.distance - rootCenter)
          ? { page, distance: center }
          : nearest;
      }, { page: currentPage, distance: Number.POSITIVE_INFINITY });
      setCurrentPage((previous) => previous === nearestPage.page ? previous : nearestPage.page);
    }, { root, rootMargin: "450px 0px", threshold: 0 });

    pageNodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [document, totalPages, currentPage, pdfPageSizes]);

  useEffect(() => {
    if (document?.fileType !== "pdf" || !document.pdfDoc) return;
    renderedPdfPages.forEach((pageNumber) => {
      const canvas = pdfCanvasRefs.current.get(pageNumber);
      if (!canvas) return;
      void renderPdfPageToCanvas(document.pdfDoc, pageNumber, canvas, (zoomLevel / 100) * 1.5).catch(() => {
        // The observer can unmount a canvas while PDF.js is rendering it.
      });
    });
  }, [document, renderedPdfPages, zoomLevel, pdfPageSizes]);

  useEffect(() => {
    if (!selectedQuestion) return;
    const firstSource = selectedSourceRefs
      .map((ref) => blockById.get(ref))
      .find((block) => block && (block.bbox || block.sourceRef.paragraph !== undefined || block.sourceRef.page !== undefined));
    if (!firstSource) return;

    selectionFocusPendingRef.current = selectedQuestion.id;
    programmaticScrollUntilRef.current = Date.now() + 700;
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      programmaticScrollUntilRef.current = 0;
      focusTimerRef.current = null;
    }, 750);

    if (document?.fileType === "pdf" && firstSource.sourceRef.page) {
      const pageNumber = firstSource.sourceRef.page;
      window.requestAnimationFrame(() => setCurrentPage(pageNumber));
      const pageNode = documentContentRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
      pageNode?.scrollIntoView({ block: "center", behavior: "smooth" });
    } else if (document?.fileType === "image") {
      const node = Array.from(documentContentRef.current?.querySelectorAll<HTMLElement>("[data-source-id]") || [])
        .find((element) => element.dataset.sourceId === firstSource.id);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      selectionFocusPendingRef.current = null;
    } else {
      const visualId = getVisualSourceId(firstSource, document?.fileType);
      const node = Array.from(documentContentRef.current?.querySelectorAll<HTMLElement>("[data-source-id]") || [])
        .find((element) => element.dataset.sourceId === visualId);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      selectionFocusPendingRef.current = null;
    }
  }, [selectedQuestionId, selectedQuestion, selectedSourceRefs, blockById, document?.fileType]);

  useEffect(() => {
    const pendingId = selectionFocusPendingRef.current;
    if (!pendingId || pendingId !== selectedQuestionId || document?.fileType !== "pdf") return;
    const firstSource = selectedSourceRefs.map((ref) => blockById.get(ref)).find((block) => block?.sourceRef.page);
    if (!firstSource) return;
    const node = Array.from(documentContentRef.current?.querySelectorAll<HTMLElement>("[data-source-id]") || [])
      .find((element) => element.dataset.sourceId === firstSource.id);
    if (!node) return;
    programmaticScrollUntilRef.current = Date.now() + 700;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    selectionFocusPendingRef.current = null;
  }, [renderedPdfPages, selectedQuestionId, selectedSourceRefs, blockById, document?.fileType]);

  useEffect(() => {
    const nodes = documentContentRef.current?.querySelectorAll<HTMLElement>("[data-source-id]") || [];
    nodes.forEach((node) => {
      const active = selectedVisualSourceIds.has(node.dataset.sourceId || "");
      node.classList.toggle("border-l-4", active && document?.fileType === "docx");
      node.classList.toggle("border-teal-500", active && document?.fileType === "docx");
      node.classList.toggle("bg-teal-50", active && document?.fileType === "docx");
      node.classList.toggle("rounded-sm", active && document?.fileType === "docx");
    });
  }, [selectedVisualSourceIds, document?.fileType, sanitizedRawHtml]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
  }, []);

  if (!document && !extractionResult) {
    return (
      <Card className="theme-surface-muted theme-border h-full flex items-center justify-center p-8 text-center">
        <div className="space-y-2 theme-text-muted">
          <FileText className="h-10 w-10 mx-auto stroke-1" />
          <p className="text-sm font-medium">Chưa có tài liệu nguồn nào được tải lên</p>
        </div>
      </Card>
    );
  }

  const handleCopyRaw = () => {
    const textToCopy = document?.rawText || "";
    if (textToCopy) {
      void navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      toast.success("Đã sao chép toàn bộ văn bản gốc của đề thi!");
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const goToPage = (page: number) => {
    const nextPage = Math.min(totalPages, Math.max(1, page));
    setCurrentPage(nextPage);
    documentContentRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${nextPage}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const handleDocumentClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-source-id]");
    const questionId = target?.dataset.sourceId ? questionByVisualSourceId.get(target.dataset.sourceId) : undefined;
    if (questionId) setSelectedQuestionId(questionId);
  };

  const handleDocumentScroll = () => {
    if (programmaticScrollUntilRef.current > Date.now() || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const root = documentContentRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const centerX = rootRect.left + root.clientWidth / 2;
      const centerY = rootRect.top + root.clientHeight / 2;
      const candidates = Array.from(root.querySelectorAll<HTMLElement>("[data-source-id]"))
        .map((node) => {
          const bounds = node.getBoundingClientRect();
          const sourceId = node.dataset.sourceId || "";
          const questionId = questionByVisualSourceId.get(sourceId);
          if (!questionId || bounds.bottom < rootRect.top || bounds.top > rootRect.bottom || bounds.right < rootRect.left || bounds.left > rootRect.right) return undefined;
          const x = Math.max(bounds.left, Math.min(centerX, bounds.right));
          const y = Math.max(bounds.top, Math.min(centerY, bounds.bottom));
          return { questionId, distance: Math.hypot(centerX - x, centerY - y) };
        })
        .filter((candidate): candidate is { questionId: string; distance: number } => !!candidate);
      const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
      if (closest && closest.distance < root.clientHeight * 0.45 && closest.questionId !== selectedQuestionId) {
        setSelectedQuestionId(closest.questionId);
      }

      if (document?.fileType === "pdf") {
        const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-page]"));
        const nearest = pages
          .map((node) => {
            const bounds = node.getBoundingClientRect();
            return { page: Number(node.dataset.pdfPage), distance: Math.abs((bounds.top + bounds.bottom) / 2 - centerY) };
          })
          .sort((a, b) => a.distance - b.distance)[0];
        if (nearest?.page && nearest.page !== currentPage) setCurrentPage(nearest.page);
      }
    });
  };

  return (
    <Card
      className={`theme-border flex flex-col h-full overflow-hidden shadow-xs transition-all ${
        isExpanded ? "fixed inset-4 z-50 shadow-2xl theme-surface" : ""
      }`}
    >
      <CardHeader className="theme-surface-muted theme-border py-3 px-4 border-b flex flex-row items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" size="sm" className="font-mono text-xs uppercase">
            {document?.fileType || "DOCX"}
          </Badge>
          <CardTitle className="text-xs sm:text-sm font-bold truncate theme-text-secondary">
            {document?.fileName || "Tài liệu đề thi gốc"}
          </CardTitle>
        </div>

        <div className="flex items-center gap-1.5">
          {document?.fileType === "pdf" && totalPages > 1 && (
            <div className="theme-surface flex items-center gap-1 theme-border px-2 py-0.5 rounded-lg border text-xs font-semibold mr-1">
              <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="p-1 rounded theme-text-muted theme-hover-surface disabled:opacity-30 cursor-pointer" aria-label="Trang trước">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-[11px] theme-text-secondary min-w-14 text-center">{currentPage} / {totalPages}</span>
              <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="p-1 rounded theme-text-muted theme-hover-surface disabled:opacity-30 cursor-pointer" aria-label="Trang sau">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <button type="button" onClick={() => setZoomLevel((zoom) => Math.max(50, zoom - 10))} className="p-1.5 rounded-lg theme-text-muted theme-hover-surface transition cursor-pointer" title="Thu nhỏ" aria-label="Thu nhỏ">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="font-mono text-xs theme-text-secondary w-9 text-center">{zoomLevel}%</span>
          <button type="button" onClick={() => setZoomLevel((zoom) => Math.min(200, zoom + 10))} className="p-1.5 rounded-lg theme-text-muted theme-hover-surface transition cursor-pointer" title="Phóng to" aria-label="Phóng to">
            <ZoomIn className="h-4 w-4" />
          </button>

          {document?.fileType === "image" && (
            <button type="button" onClick={() => setRotation((value) => (value + 90) % 360)} className="p-1.5 rounded-lg theme-text-muted theme-hover-surface transition cursor-pointer" title="Xoay ảnh 90°" aria-label="Xoay ảnh 90 độ">
              <RotateCw className="h-4 w-4" />
            </button>
          )}

          <span className="h-4 w-px bg-neutral-300 mx-1" />
          <button type="button" onClick={handleCopyRaw} className="p-1.5 rounded-lg theme-text-muted theme-hover-surface transition cursor-pointer" title="Sao chép toàn bộ văn bản gốc" aria-label="Sao chép văn bản">
            {isCopied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => setIsExpanded((expanded) => !expanded)} className="p-1.5 rounded-lg theme-text-muted theme-hover-surface transition cursor-pointer" title={isExpanded ? "Thu nhỏ lại" : "Mở rộng toàn màn hình"} aria-label={isExpanded ? "Thu nhỏ" : "Mở rộng"}>
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>

      <div
        ref={documentContentRef}
        onClick={handleDocumentClick}
        onScroll={handleDocumentScroll}
        className="theme-surface-inset p-0 flex-1 overflow-auto font-sans"
      >
        <div className="p-4 sm:p-6 transition-all origin-top">
          {selectedQuestion && (
            <div className="mb-4 rounded-xl bg-teal-50 p-3 border border-teal-200 text-xs text-teal-950 flex items-center justify-between gap-2 shadow-2xs">
              <span className="flex items-center gap-1.5 font-bold">
                <Sparkles className="h-4 w-4 text-teal-700" />
                <span>Đang đồng bộ xem câu {selectedQuestion.order}:</span>
              </span>
              <span className="font-mono text-[11px] text-teal-700 theme-surface px-2 py-0.5 rounded-md border border-teal-100">
                Đáp án: {selectedQuestion.correctAnswers.length ? selectedQuestion.correctAnswers.join(", ") : "Chưa xác định"} ({selectedQuestion.answerStatus || "chờ duyệt"})
              </span>
            </div>
          )}

          {document?.fileType === "pdf" && document.pdfDoc ? (
            <div className="flex min-w-full flex-col items-center gap-4 py-2">
              {Array.from({ length: totalPages }, (_, index) => {
                const pageNumber = index + 1;
                const size = pdfPageSizes[pageNumber] || { width: 595, height: 842 };
                const pageIR = document.documentIR?.pages.find((page) => page.pageNumber === pageNumber);
                const pageBlocks = pageIR?.blocks.filter((block) => block.bbox) || [];
                return (
                  <div
                    key={pageNumber}
                    data-pdf-page={pageNumber}
                    className="theme-document-canvas relative shrink-0 overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-lg"
                    style={{ width: `${zoomLevel}%`, aspectRatio: `${size.width} / ${size.height}` }}
                  >
                    {renderedPdfPages.has(pageNumber) && (
                      <>
                        <canvas
                          ref={(canvas) => {
                            if (canvas) pdfCanvasRefs.current.set(pageNumber, canvas);
                            else pdfCanvasRefs.current.delete(pageNumber);
                          }}
                          className="absolute inset-0 block h-full w-full"
                        />
                        {pageBlocks.map((block) => {
                          const bbox = block.bbox!;
                          const width = pageIR?.width || size.width;
                          const height = pageIR?.height || size.height;
                          const selected = selectedSourceRefSet.has(block.id);
                          return (
                            <div
                              key={block.id}
                              data-source-id={block.id}
                              aria-label={selected ? "Nguồn của câu đang chọn" : "Nguồn trong tài liệu"}
                              className={`absolute cursor-pointer transition-colors ${selected ? "border-2 border-amber-500 bg-amber-300/25" : "border border-transparent hover:border-sky-500/70 hover:bg-sky-300/10"}`}
                              style={{
                                left: `${(bbox[0] / width) * 100}%`,
                                top: `${((height - bbox[3]) / height) * 100}%`,
                                width: `${((bbox[2] - bbox[0]) / width) * 100}%`,
                                height: `${Math.max(0.6, ((bbox[3] - bbox[1]) / height) * 100)}%`,
                              }}
                            />
                          );
                        })}
                      </>
                    )}
                    {!renderedPdfPages.has(pageNumber) && (
                      <span className="absolute bottom-2 right-3 rounded bg-white/80 px-2 py-0.5 text-[10px] text-neutral-500">Trang {pageNumber}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : document?.fileType === "image" && (document.imageBase64 || document.previewUrl) ? (
            <div className="flex flex-col items-center justify-center p-2">
              <div
                className="theme-document-canvas relative inline-block rounded-lg border border-neutral-200 bg-white"
                style={{ transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`, transformOrigin: "top center" }}
              >
                <img src={document.imageBase64 || document.previewUrl} alt={document.fileName} className="block max-w-full h-auto rounded-xl object-contain" />
                {currentPageIR?.blocks.filter((block) => block.bbox).map((block) => {
                  const bbox = block.bbox!;
                  const width = currentPageIR.width || 1;
                  const height = currentPageIR.height || 1;
                  const selected = selectedSourceRefSet.has(block.id);
                  return (
                    <div
                      key={block.id}
                      data-source-id={block.id}
                      aria-label={selected ? "Vùng OCR của câu đang chọn" : "Vùng chữ được nhận diện"}
                      className={`absolute cursor-pointer transition-colors ${selected ? "border-2 border-amber-500 bg-amber-300/25" : "border border-transparent hover:border-sky-500/70 hover:bg-sky-300/10"}`}
                      style={{ left: `${(bbox[0] / width) * 100}%`, top: `${(bbox[1] / height) * 100}%`, width: `${((bbox[2] - bbox[0]) / width) * 100}%`, height: `${Math.max(0.8, ((bbox[3] - bbox[1]) / height) * 100)}%` }}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              className="theme-document-paper min-h-[500px] rounded-lg border border-neutral-200 bg-white p-6 font-sans text-sm leading-relaxed text-neutral-800 sm:p-8"
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left" }}
            >
              {document?.rawHtml ? (
                <div
                  className="prose prose-sm max-w-none [&_u]:underline [&_u]:decoration-teal-600 [&_u]:decoration-2 [&_strong]:text-teal-950 [&_mark]:bg-yellow-200 [&_.text-color-red]:text-rose-600 [&_table]:border-collapse [&_table]:border [&_table]:border-neutral-300 [&_td]:border [&_td]:border-neutral-300 [&_td]:p-2 [&_th]:border [&_th]:border-neutral-300 [&_th]:p-2"
                  dangerouslySetInnerHTML={{ __html: sanitizedRawHtml }}
                />
              ) : document?.documentIR?.flowBlocks?.length ? (
                <div className="space-y-2">
                  {document.documentIR.flowBlocks.map((block) => (
                    <div key={block.id} data-source-id={block.id} className="whitespace-pre-wrap">
                      {block.text}
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800 leading-relaxed">{document?.rawText || "Nội dung văn bản đề thi"}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default DocumentViewer;
