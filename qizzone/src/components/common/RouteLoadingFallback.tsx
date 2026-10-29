import { useEffect, useState } from "react";

export function RouteLoadingFallback() {
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    // Only show spinner if loading takes more than 150ms to prevent micro-flickers
    const timer = setTimeout(() => setShowSpinner(true), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative w-full">
      {/* Top indeterminate progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-neutral-100 overflow-hidden">
        <div className="h-full bg-blue-600 route-progress-bar origin-left w-full" />
      </div>

      {showSpinner && (
        <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-neutral-400">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-200 border-t-blue-600 mb-3" />
          <p className="text-xs font-medium text-neutral-500">Đang tải trang...</p>
        </div>
      )}
    </div>
  );
}

export function AuthLoadingFallback() {
  return (
    <div className="app-shell min-h-screen flex flex-col items-center justify-center p-4 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-neutral-200 border-t-blue-600 mb-4" />
      <p className="text-sm font-semibold text-neutral-800">Đang chuẩn bị phiên làm việc...</p>
      <p className="text-xs text-neutral-500 mt-1">Hệ thống đang kết nối dữ liệu an toàn</p>
    </div>
  );
}

export default RouteLoadingFallback;
