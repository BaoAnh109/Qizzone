import { useEffect, useState } from "react";
import { ToastProvider } from "@/app/ToastProvider";
import AppRoutes from "@/routes/AppRoutes";
import { disposeAuthListener, useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
import { LegacyMigrationAssistant } from "@/components/common/LegacyMigrationAssistant";
import { Button } from "@/components/ui/Button";

export function App() {
  return (
    <ToastProvider>
      <AuthBootstrap />
    </ToastProvider>
  );
}

function AuthBootstrap() {
  const initialize = useAuthStore(state => state.initialize);
  useEffect(() => {
    void initialize();
    return disposeAuthListener;
  }, [initialize]);
  return <CloudDataBootstrap />;
}

function CloudDataBootstrap() {
  const user = useAuthStore(state => state.user);
  const isInitialized = useAuthStore(state => state.isInitialized);
  const loadQuizzes = useQuizStore(state => state.load);
  const loadExamData = useExamSessionStore(state => state.load);
  const resetQuizzes = useQuizStore(state => state.reset);
  const resetExamData = useExamSessionStore(state => state.reset);
  const quizError = useQuizStore(state => state.error);
  const examError = useExamSessionStore(state => state.error);
  const [isRetrying, setIsRetrying] = useState(false);
  const cloudError = quizError || examError;

  const retryCloudData = async () => {
    setIsRetrying(true);
    try {
      await Promise.all([loadQuizzes(), loadExamData()]);
    } catch {
      // The stores keep the localized error visible for the next retry.
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (!isInitialized || !user) {
      resetQuizzes();
      resetExamData();
      return;
    }
    void (async () => {
      try {
        await Promise.all([loadQuizzes(), loadExamData()]);
      } catch {
        // Individual pages remain available so the user can retry after connectivity is restored.
      }
    })();
  }, [isInitialized, user, loadQuizzes, loadExamData, resetQuizzes, resetExamData]);

  return (
    <>
      <AppRoutes />
      {user && cloudError && (
        <div className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-xl border border-rose-200 bg-white p-3 text-sm text-rose-800 shadow-xl">
          <span className="flex-1">Không thể đồng bộ dữ liệu: {cloudError}</span>
          <Button size="sm" variant="outline" isLoading={isRetrying} onClick={() => void retryCloudData()}>
            Thử lại
          </Button>
        </div>
      )}
      {user && (
        <LegacyMigrationAssistant
          key={user.id}
          user={user}
          onCompleted={() => Promise.all([loadQuizzes(), loadExamData()]).then(() => undefined)}
        />
      )}
    </>
  );
}

export default App;
