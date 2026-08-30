import { useState, useCallback, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { useExtractionStore } from "@/store/extractionStore";

export function ResizableSplitter() {
  const setSplitterRatio = useExtractionStore((state) => state.setSplitterRatio);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const windowWidth = window.innerWidth;
      const newRatio = Math.round((e.clientX / windowWidth) * 100);
      setSplitterRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, setSplitterRatio]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`relative hidden md:flex items-center justify-center w-3 hover:w-3 cursor-col-resize select-none transition-colors group z-20 ${
        isDragging ? "bg-indigo-600" : "bg-transparent hover:bg-indigo-500/20"
      }`}
    >
      <div className="flex h-12 w-3 items-center justify-center rounded-full bg-white border border-neutral-300 shadow-xs group-hover:border-indigo-400 group-hover:scale-110 transition">
        <GripVertical className="h-3.5 w-3.5 text-neutral-400 group-hover:text-indigo-600" />
      </div>
    </div>
  );
}

export default ResizableSplitter;
