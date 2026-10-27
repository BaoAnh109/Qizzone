import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CircleAlert, CircleX, Clock3, RotateCcw } from 'lucide-react';
import { MathRenderer } from '@/components/common/MathRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { usePracticeStore } from '@/store/practiceStore';
import { useToast } from '@/hooks/useToast';
import { getRetryableWrongQuestions, practiceErrorMessage } from '@/utils/practice';
import type { PracticeResultDetail } from '@/types/practice';

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
}

function orderedOptions(detail: PracticeResultDetail) {
  if (!detail.optionOrder.length) return detail.options;
  return detail.optionOrder.flatMap(id => {
    const option = detail.options.find(item => item.id === id);
    return option ? [option] : [];
  });
}

function AnswerReview({ detail }: { detail: PracticeResultDetail }) {
  const rightAnswers = detail.correctAnswers.map(id => detail.options.find(option => option.id === id)).filter(Boolean);
  const selectedAnswers = detail.selectedAnswers.map(id => detail.options.find(option => option.id === id)).filter(Boolean);
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium leading-6 text-neutral-900"><MathRenderer content={detail.content} /></div>
      <div className="space-y-2">
        {orderedOptions(detail).map(option => {
          const isCorrect = detail.correctAnswers.includes(option.id);
          const isSelectedWrong = detail.selectedAnswers.includes(option.id) && !isCorrect;
          return (
            <div key={option.id} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${isCorrect ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : isSelectedWrong ? 'border-rose-300 bg-rose-50 text-rose-950' : 'border-neutral-200 bg-white text-neutral-600'}`}>
              <span className="w-5 shrink-0 font-bold">{isCorrect ? '✓' : isSelectedWrong ? '×' : option.id}</span>
              <span className="min-w-0 flex-1"><MathRenderer content={option.content} /></span>
              {isSelectedWrong && <span className="shrink-0 text-[11px] font-semibold">Bạn chọn</span>}
            </div>
          );
        })}
      </div>
      {selectedAnswers.length === 0 ? (
        <p className="text-xs font-semibold text-amber-800">Bạn chưa trả lời câu này.</p>
      ) : rightAnswers.length > 0 ? (
        <p className="text-xs text-neutral-600">Đáp án đúng: {rightAnswers.map((option, index) => <span key={option!.id}>{index > 0 ? ', ' : ''}<MathRenderer content={`${option!.id}. ${option!.content}`} /></span>)}</p>
      ) : null}
      {detail.explanation && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-900">Lời giải</p>
          <div className="text-sm leading-6 text-sky-950"><MathRenderer content={detail.explanation} /></div>
        </div>
      )}
    </div>
  );
}

export function PracticeResult() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const finish = usePracticeStore(state => state.finish);
  const retry = usePracticeStore(state => state.retry);
  const isStarting = usePracticeStore(state => state.isStarting);
  const isFinishing = usePracticeStore(state => sessionId ? state.finishingSessions[sessionId] : false);
  const cachedResult = usePracticeStore(state => sessionId ? state.results[sessionId] : undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [verifiedSessionId, setVerifiedSessionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (sessionId) {
      void finish(sessionId).then(() => {
        if (active) {
          setLoadError(null);
          setVerifiedSessionId(sessionId);
        }
      }).catch(error => {
        if (active) setLoadError(practiceErrorMessage(error, 'Không thể tải kết quả luyện tập.'));
      });
    }
    return () => { active = false; };
  }, [sessionId, finish]);

  const missedQuestions = useMemo(() => getRetryableWrongQuestions(cachedResult?.details || []), [cachedResult]);

  const handleRetry = async (mode: 'wrong' | 'all') => {
    if (!cachedResult) return;
    setRetryError(null);
    try {
      const session = await retry(cachedResult.sessionId, mode);
      navigate(`/student/practice/${session.id}/room`);
    } catch (error) {
      const message = practiceErrorMessage(error, 'Không thể bắt đầu lượt luyện lại.');
      setRetryError(message);
      toast.error(message);
    }
  };

  const displayedError = loadError || (!sessionId ? 'Không tìm thấy lượt luyện tập. Hãy quay lại lịch sử luyện tập.' : null);
  if (displayedError) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
        <h1 className="text-xl font-bold text-neutral-900">Không thể tải kết quả</h1>
        <p className="text-sm text-neutral-600">{displayedError}</p>
        <Button variant="outline" onClick={() => navigate('/student/practice')} leftIcon={<ArrowLeft className="h-4 w-4" />}>Về lịch sử luyện tập</Button>
      </div>
    );
  }

  if (isFinishing || verifiedSessionId !== sessionId || !cachedResult) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-neutral-500">Đang tính kết quả luyện tập…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Badge variant="success" size="sm">Kết quả luyện tập</Badge>
          <h1 className="mt-2 text-2xl font-bold text-neutral-900">{cachedResult.quizTitle}</h1>
          <p className="mt-1 text-sm text-neutral-500">{cachedResult.subject} · {new Date(cachedResult.finishedAt).toLocaleString('vi-VN')}</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/student/practice')} leftIcon={<ArrowLeft className="h-4 w-4" />}>Về lịch sử luyện tập</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-neutral-500">Số câu đúng</p><p className="mt-1 text-2xl font-extrabold text-emerald-800">{cachedResult.correctCount}<span className="text-base font-semibold text-neutral-400"> / {cachedResult.totalQuestions}</span></p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-neutral-500">Tỉ lệ đúng</p><p className="mt-1 text-2xl font-extrabold text-indigo-800">{cachedResult.percentage}%</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="flex items-center justify-center gap-1 text-xs text-neutral-500"><Clock3 className="h-3.5 w-3.5" />Thời gian đã luyện</p><p className="mt-1 font-mono text-2xl font-extrabold text-neutral-800">{formatDuration(cachedResult.durationSeconds)}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="success" size="sm">{cachedResult.correctCount} đúng</Badge>
        <Badge variant="destructive" size="sm">{cachedResult.incorrectCount} sai</Badge>
        <Badge variant="secondary" size="sm">{cachedResult.skippedCount} chưa trả lời</Badge>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CircleX className="h-5 w-5 text-rose-600" />
          <h2 className="text-lg font-bold text-neutral-900">Câu trả lời sai ({missedQuestions.length})</h2>
        </div>
        {missedQuestions.length > 0 ? missedQuestions.map(detail => (
          <Card key={detail.questionId} className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-3 bg-neutral-50/70 p-4">
              <CardTitle className="text-sm font-bold">Câu {detail.order}</CardTitle>
              <Badge variant={detail.checked ? 'destructive' : 'warning'} size="sm">{detail.checked ? 'Chưa chính xác' : 'Chưa trả lời'}</Badge>
            </CardHeader>
            <CardContent className="space-y-4 p-4"><AnswerReview detail={detail} /></CardContent>
          </Card>
        )) : (
          <Card className={cachedResult.skippedCount > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-emerald-200 bg-emerald-50/50'}>
            <CardContent className={`flex items-center gap-2 p-5 text-sm font-semibold ${cachedResult.skippedCount > 0 ? 'text-amber-900' : 'text-emerald-900'}`}>
              {cachedResult.skippedCount > 0
                ? <CircleAlert className="h-5 w-5" />
                : <CheckCircle2 className="h-5 w-5" />}
              {cachedResult.skippedCount > 0
                ? `Không có câu đã kiểm tra bị sai. Còn ${cachedResult.skippedCount} câu chưa trả lời.`
                : 'Bạn đã trả lời đúng tất cả câu hỏi.'}
            </CardContent>
          </Card>
        )}
      </section>

      {retryError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{retryError}</p>}
      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => navigate('/student/practice')} leftIcon={<ArrowLeft className="h-4 w-4" />}>Về lịch sử luyện tập</Button>
        <Button
          variant="outline"
          onClick={() => void handleRetry('wrong')}
          disabled={missedQuestions.length === 0}
          isLoading={isStarting}
          leftIcon={<RotateCcw className="h-4 w-4" />}
        >
          Luyện lại câu sai
        </Button>
        <Button onClick={() => void handleRetry('all')} isLoading={isStarting} leftIcon={<RotateCcw className="h-4 w-4" />}>
          Luyện lại toàn bộ
        </Button>
      </div>
    </div>
  );
}

export default PracticeResult;
