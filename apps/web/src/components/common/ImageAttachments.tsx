import { resolveQuestionImageUrl } from "@/lib/questionMedia";

interface ImageAttachmentsProps {
  images?: string[];
  alt?: string;
  className?: string;
}

export function ImageAttachments({ images, alt = "Hình minh họa", className = "" }: ImageAttachmentsProps) {
  const safeImages = (images || []).flatMap(image => {
    const src = resolveQuestionImageUrl(image);
    return src ? [{ image, src }] : [];
  });
  if (!safeImages.length) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {safeImages.map(({ image, src }, index) => (
        <img
          key={`${index}-${image.slice(0, 40)}`}
          src={src}
          alt={`${alt} ${index + 1}`}
          loading="lazy"
          decoding="async"
          className="max-h-[32rem] max-w-full rounded-lg border theme-border object-contain"
        />
      ))}
    </div>
  );
}

export default ImageAttachments;
