import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

interface QuestionFrameProps {
  questionNumber: number;
  questionCount: number;
  headerMeta?: ReactNode;
  headerActions?: ReactNode;
  prompt: ReactNode;
  feedback?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function QuestionFrame({
  questionNumber,
  questionCount,
  headerMeta,
  headerActions,
  prompt,
  feedback,
  footer,
  children,
}: QuestionFrameProps) {
  return (
    <Card className="overflow-hidden border-neutral-200/90 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-neutral-200/60 bg-neutral-50/70 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="primary" size="md">
            Câu {questionNumber} / {questionCount}
          </Badge>
          {headerMeta}
        </div>
        <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
      </CardHeader>

      <CardContent className="space-y-6 p-5 sm:p-7">
        <div className="text-base font-medium leading-relaxed text-neutral-900 sm:text-lg">
          {prompt}
        </div>
        <div className="space-y-3 pt-2">{children}</div>
        {feedback}
        {footer}
      </CardContent>
    </Card>
  );
}

export default QuestionFrame;
