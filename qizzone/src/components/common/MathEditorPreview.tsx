import { useState, useRef } from "react";
import { Sparkles, Eye, Code, HelpCircle } from "lucide-react";
import { MathRenderer } from "./MathRenderer";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export interface MathEditorPreviewProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  error?: string;
  rows?: number;
  className?: string;
}

const MATH_SHORTCUTS = [
  { label: "Phân số", snippet: "$\\frac{a}{b}$", tip: "\\frac{tử}{mẫu}" },
  { label: "Căn thức", snippet: "$\\sqrt{x^2 + 1}$", tip: "\\sqrt{x}" },
  { label: "Lũy thừa", snippet: "$x^2$", tip: "x^{n}" },
  { label: "Chỉ số", snippet: "$x_1$", tip: "x_{n}" },
  { label: "Tích phân", snippet: "$$\\int_{a}^{b} f(x)dx$$", tip: "\\int_{a}^{b}" },
  { label: "Tổng", snippet: "$$\\sum_{i=1}^{n} x_i$$", tip: "\\sum" },
  { label: "Giới hạn", snippet: "$$\\lim_{x \\to 0} f(x)$$", tip: "\\lim" },
  { label: "α Beta", snippet: "$\\alpha, \\beta, \\pi, \\Delta$", tip: "Ký hiệu Hy Lạp" },
  { label: "≤ ≥ ≠", snippet: "$\\le, \\ge, \\ne, \\approx$", tip: "Dấu so sánh" },
  { label: "Véc tơ", snippet: "$\\vec{u}$", tip: "\\vec{u}" },
];

export function MathEditorPreview({
  label,
  value,
  onChange,
  placeholder = "Nhập văn bản hoặc công thức Toán $x^2 + y^2 = r^2$...",
  helperText,
  error,
  rows = 3,
  className,
}: MathEditorPreviewProps) {
  const [activeTab, setActiveTab] = useState<"write" | "preview" | "split">("split");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange((value ? value + " " : "") + snippet);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const newText = text.substring(0, start) + snippet + text.substring(end);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + snippet.length, start + snippet.length);
    }, 50);
  };

  return (
    <div className={cn("space-y-1.5 text-left w-full", className)}>
      {/* Header with Mode Switch */}
      <div className="flex items-center justify-between">
        {label && (
          <label className="text-sm font-semibold text-neutral-800 select-none">
            {label}
          </label>
        )}

        <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("write")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 font-medium transition cursor-pointer",
              activeTab === "write"
                ? "bg-white text-indigo-700 shadow-2xs font-semibold"
                : "text-neutral-600 hover:text-neutral-900"
            )}
          >
            <Code className="h-3 w-3" />
            <span>Soạn thảo</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("split")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 font-medium transition cursor-pointer hidden sm:flex",
              activeTab === "split"
                ? "bg-white text-indigo-700 shadow-2xs font-semibold"
                : "text-neutral-600 hover:text-neutral-900"
            )}
          >
            <Sparkles className="h-3 w-3" />
            <span>Song song</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 font-medium transition cursor-pointer",
              activeTab === "preview"
                ? "bg-white text-indigo-700 shadow-2xs font-semibold"
                : "text-neutral-600 hover:text-neutral-900"
            )}
          >
            <Eye className="h-3 w-3" />
            <span>Xem trước</span>
          </button>
        </div>
      </div>

      {/* Quick Insert Math Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-indigo-50/60 p-2 border border-indigo-100 text-xs">
        <span className="text-[11px] font-semibold text-indigo-800 flex items-center gap-1 mr-1">
          <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
          Chèn nhanh:
        </span>
        {MATH_SHORTCUTS.map((item, idx) => (
          <Button
            key={idx}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => insertSnippet(item.snippet)}
            title={item.tip}
            className="h-6 px-2 text-[11px] bg-white border-indigo-200 text-indigo-900 hover:bg-indigo-100 hover:text-indigo-950 font-mono"
          >
            {item.label}
          </Button>
        ))}
      </div>

      {/* Editor & Preview Area */}
      <div
        className={cn(
          "grid gap-3",
          activeTab === "split" ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
        )}
      >
        {/* Editor Box */}
        {(activeTab === "write" || activeTab === "split") && (
          <div>
            <textarea
              ref={textareaRef}
              rows={rows}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className={cn(
                "w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 font-mono shadow-xs",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500",
                error
                  ? "border-rose-500 text-rose-950"
                  : "border-neutral-300 focus-visible:border-indigo-600"
              )}
            />
          </div>
        )}

        {/* Live KaTeX Preview Box */}
        {(activeTab === "preview" || activeTab === "split") && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-3.5 min-h-[85px] max-h-60 overflow-y-auto flex flex-col justify-start">
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-neutral-200/60 text-[11px] text-neutral-400 font-medium">
              <span>Kết quả hiển thị (Live KaTeX):</span>
              <span className="flex items-center gap-0.5 text-emerald-600">
                <Sparkles className="h-3 w-3" /> Realtime
              </span>
            </div>

            {value ? (
              <div className="text-sm text-neutral-900 pt-1">
                <MathRenderer content={value} />
              </div>
            ) : (
              <p className="text-xs text-neutral-400 italic pt-1">
                Chưa có nội dung xem trước... Hãy gõ $công thức$ để thấy kết quả.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Error or Helper text */}
      {error ? (
        <p className="text-xs font-medium text-rose-600">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-neutral-500 flex items-center gap-1">
          <HelpCircle className="h-3 w-3 shrink-0" />
          <span>{helperText}</span>
        </p>
      ) : null}
    </div>
  );
}

export default MathEditorPreview;
