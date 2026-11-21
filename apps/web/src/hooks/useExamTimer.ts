import { useState, useEffect, useRef, useCallback } from "react";

export interface UseExamTimerOptions {
  startTime: number; // timestamp in ms
  durationMinutes: number; // 0 = unlimited
  onTimeUp?: () => void;
}

export interface UseExamTimerReturn {
  formattedTime: string;
  remainingSeconds: number;
  elapsedSeconds: number;
  isWarning: boolean; // < 5 minutes
  isCritical: boolean; // < 1 minute
  isTimeUp: boolean;
  isUnlimited: boolean;
}

function formatSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num: number) => num.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function useExamTimer({
  startTime,
  durationMinutes,
  onTimeUp,
}: UseExamTimerOptions): UseExamTimerReturn {
  const isUnlimited = durationMinutes === 0;

  const onTimeUpRef = useRef(onTimeUp);
  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  const hasTriggeredTimeUpRef = useRef(false);

  const getComputedState = useCallback(() => {
    const now = Date.now();
    const elapsed = startTime > 0 ? Math.max(0, Math.floor((now - startTime) / 1000)) : 0;

    if (isUnlimited) {
      return {
        remaining: 0,
        elapsed,
        isTimeUp: false,
      };
    }

    const endTime = startTime + durationMinutes * 60 * 1000;
    const remaining = startTime > 0 ? Math.max(0, Math.floor((endTime - now) / 1000)) : durationMinutes * 60;
    const timeUp = startTime > 0 && remaining <= 0;

    return {
      remaining,
      elapsed,
      isTimeUp: timeUp,
    };
  }, [startTime, durationMinutes, isUnlimited]);

  const [timeState, setTimeState] = useState(() => {
    if (isUnlimited) {
      return { remaining: 0, elapsed: 0, isTimeUp: false };
    }
    return {
      remaining: durationMinutes * 60,
      elapsed: 0,
      isTimeUp: false,
    };
  });

  useEffect(() => {
    const tick = () => {
      const current = getComputedState();
      setTimeState(current);

      if (!isUnlimited && current.isTimeUp && !hasTriggeredTimeUpRef.current) {
        hasTriggeredTimeUpRef.current = true;
        if (onTimeUpRef.current) {
          onTimeUpRef.current();
        }
      }
    };

    tick();
    const intervalId = setInterval(tick, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [getComputedState, isUnlimited]);

  const isWarning = !isUnlimited && timeState.remaining <= 300 && timeState.remaining > 60;
  const isCritical = !isUnlimited && timeState.remaining <= 60 && timeState.remaining > 0;

  const displaySeconds = isUnlimited
    ? timeState.elapsed
    : timeState.remaining;

  return {
    formattedTime: formatSeconds(displaySeconds),
    remainingSeconds: timeState.remaining,
    elapsedSeconds: timeState.elapsed,
    isWarning,
    isCritical,
    isTimeUp: timeState.isTimeUp,
    isUnlimited,
  };
}

export default useExamTimer;
