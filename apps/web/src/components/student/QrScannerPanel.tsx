import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff, ImageUp, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { extractClassroomCode } from "@/utils/classroomInvite";

interface QrScannerPanelProps {
  onDetected: (code: string) => void;
  disabled?: boolean;
}

export function QrScannerPanel({ onDetected, disabled = false }: QrScannerPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectedRef = useRef(false);

  const [cameraState, setCameraState] = useState<"idle" | "starting" | "active" | "error">("idle");
  const [scanError, setScanError] = useState("");
  const [readingImage, setReadingImage] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState("idle");
  }, []);

  const handleDecodedValue = useCallback(
    (raw: string) => {
      if (detectedRef.current || disabled) return;
      const code = extractClassroomCode(raw);
      if (!code) {
        setScanError("Mã QR không chứa mã lớp hợp lệ.");
        return;
      }
      detectedRef.current = true;
      stopCamera();
      onDetected(code);
    },
    [disabled, onDetected, stopCamera]
  );

  const startCamera = useCallback(async () => {
    if (disabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setScanError("Trình duyệt không hỗ trợ truy cập camera. Hãy tải ảnh mã QR lên thay thế.");
      return;
    }

    stopCamera();
    detectedRef.current = false;
    setScanError("");
    setCameraState("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      setCameraState("active");

      const scanFrame = () => {
        if (detectedRef.current) return;
        const currentVideo = videoRef.current;
        const canvas = canvasRef.current;
        if (currentVideo && canvas && currentVideo.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
          const width = currentVideo.videoWidth;
          const height = currentVideo.videoHeight;
          if (width > 0 && height > 0) {
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(currentVideo, 0, 0, width, height);
              const imageData = ctx.getImageData(0, 0, width, height);
              const result = jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" });
              if (result?.data) {
                handleDecodedValue(result.data);
                return;
              }
            }
          }
        }
        rafRef.current = window.requestAnimationFrame(scanFrame);
      };

      rafRef.current = window.requestAnimationFrame(scanFrame);
    } catch (error) {
      stopCamera();
      setCameraState("error");
      const message =
        error instanceof Error && /notallowed|permission/i.test(error.name + error.message)
          ? "Chưa được cấp quyền camera. Hãy cho phép camera hoặc tải ảnh mã QR lên."
          : "Không thể bật camera. Bạn có thể tải ảnh mã QR lên để quét.";
      setScanError(message);
    }
  }, [disabled, handleDecodedValue, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleImageUpload = async (file?: File) => {
    if (!file || disabled) return;
    setScanError("");
    setReadingImage(true);
    detectedRef.current = false;

    try {
      const bitmapUrl = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Không thể đọc ảnh đã chọn."));
          image.src = bitmapUrl;
        });

        const canvas = canvasRef.current ?? document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
        if (!result?.data) {
          setScanError("Không tìm thấy mã QR trong ảnh này. Hãy chọn ảnh rõ nét hơn.");
          return;
        }
        handleDecodedValue(result.data);
      } finally {
        URL.revokeObjectURL(bitmapUrl);
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Không thể quét mã QR từ ảnh.");
    } finally {
      setReadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border theme-border theme-surface-muted">
        <video
          ref={videoRef}
          muted
          playsInline
          className={`aspect-video w-full object-cover ${cameraState === "active" ? "block" : "hidden"}`}
        />
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

        {cameraState === "active" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-44 w-44 rounded-2xl border-2 border-blue-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}

        {cameraState !== "active" && (
          <div className="flex min-h-[210px] flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
              {cameraState === "starting" ? (
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              ) : (
                <QrCode className="h-6 w-6" aria-hidden="true" />
              )}
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold theme-text-primary">
                {cameraState === "starting" ? "Đang mở camera…" : "Quét mã QR lớp học"}
              </p>
              <p className="text-xs theme-text-secondary">
                Đưa mã QR của giáo viên vào khung hình hoặc tải ảnh mã QR từ thiết bị.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {cameraState === "active" ? (
          <Button
            type="button"
            variant="outline"
            onClick={stopCamera}
            leftIcon={<CameraOff className="h-4 w-4" />}
            className="flex-1"
          >
            Tắt camera
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            onClick={() => void startCamera()}
            disabled={disabled || cameraState === "starting"}
            leftIcon={<Camera className="h-4 w-4" />}
            className="flex-1"
          >
            Bật camera quét QR
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || readingImage}
          isLoading={readingImage}
          leftIcon={<ImageUp className="h-4 w-4" />}
          className="flex-1"
        >
          Tải ảnh QR
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Chọn ảnh chứa mã QR lớp học"
          onChange={(event) => void handleImageUpload(event.target.files?.[0])}
        />
      </div>

      {scanError && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">
          {scanError}
        </p>
      )}
    </div>
  );
}
