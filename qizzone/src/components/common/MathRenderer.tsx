import { useMemo } from "react";
import katex from "katex";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

export interface MathRendererProps {
  content: string;
  className?: string;
  inline?: boolean;
}

interface TextSegment {
  type: "text" | "inline_math" | "block_math";
  value: string;
}

/**
 * Parses a string containing LaTeX markers into structured segments:
 * - $$math$$ -> block math
 * - $math$   -> inline math
 * - plain text
 */
function parseMathSegments(text: string): TextSegment[] {
  if (!text) return [];

  const segments: TextSegment[] = [];
  // Regex matches $$...$$ (block) OR $...$ (inline)
  const regex = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchStr = match[0];

    // Push preceding plain text
    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        value: text.slice(lastIndex, matchIndex),
      });
    }

    if (matchStr.startsWith("$$") && matchStr.endsWith("$$")) {
      segments.push({
        type: "block_math",
        value: matchStr.slice(2, -2).trim(),
      });
    } else if (matchStr.startsWith("$") && matchStr.endsWith("$")) {
      segments.push({
        type: "inline_math",
        value: matchStr.slice(1, -1).trim(),
      });
    }

    lastIndex = matchIndex + matchStr.length;
  }

  // Push any trailing plain text
  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      value: text.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Safely renders LaTeX expression using KaTeX with XSS sanitization
 */
function renderKatexHtml(latex: string, displayMode: boolean): string {
  try {
    const rawHtml = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
      strict: false,
    });
    return DOMPurify.sanitize(rawHtml);
  } catch (err) {
    console.warn("KaTeX render error:", err);
    return `<span class="text-rose-500 font-mono text-xs">[Lỗi công thức: ${DOMPurify.sanitize(
      latex
    )}]</span>`;
  }
}

export function MathRenderer({
  content,
  className,
  inline = false,
}: MathRendererProps) {
  const segments = useMemo(() => parseMathSegments(content), [content]);

  if (!content) return null;

  return (
    <span
      className={cn(
        "leading-relaxed text-inherit break-words",
        inline ? "inline" : "inline-block",
        className
      )}
    >
      {segments.map((seg, idx) => {
        if (seg.type === "text") {
          // Render regular text preserving line breaks
          return (
            <span key={idx} className="whitespace-pre-line">
              {seg.value}
            </span>
          );
        }

        const isBlock = seg.type === "block_math";
        const html = renderKatexHtml(seg.value, isBlock);

        if (isBlock) {
          return (
            <div
              key={idx}
              className="my-3 overflow-x-auto overflow-y-hidden text-center py-1"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        return (
          <span
            key={idx}
            className="inline-math mx-0.5 align-baseline"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}

export default MathRenderer;
