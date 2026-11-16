import { MathRenderer } from "@/components/common/MathRenderer";
import { ImageAttachments } from "@/components/common/ImageAttachments";

interface QuestionContentProps {
  content: string;
  images?: string[];
  imageAlt?: string;
  className?: string;
}

export function QuestionContent({ content, images, imageAlt = "Hình trong đề", className = "" }: QuestionContentProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      <MathRenderer content={content} />
      <ImageAttachments images={images} alt={imageAlt} />
    </div>
  );
}

export default QuestionContent;
