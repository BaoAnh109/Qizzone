import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Flag, ListChecks } from 'lucide-react';
import { MathRenderer } from '@/components/common/MathRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { QuestionFrame } from '@/components/student/QuestionFrame';
import { useToast } from '@/hooks/useToast';
import { usePracticeStore } from '@/store/practiceStore';
import { useQuizStore } from '@/store/quizStore';
import type { OptionId } from '@/types/quiz';
import { practiceErrorMessage } from '@/utils/practice';

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
}

export function PracticeRoom() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const open = usePracticeStore(state => state.open);
  const setQuestionIndex = usePracticeStore(state => state.setQuestionIndex);
  const selectAnswer = usePracticeStore(state => state.selectAnswer);
  const toggleFlag = usePracticeStore(state => state.toggleFlag);
  const checkAnswer = usePracticeStore(state => state.checkAnswer);
  const finish = usePracticeStore(state => state.finish);
  const session = usePracticeStore(state => sessionId ? state.sessions[sessionId] : undefined);
  const isLoading = usePracticeStore(state => sessionId ? state.loadingSessions[sessionId] : false);
  const isFinishing = usePracticeStore(state => sessionId ? state.finishingSessions[sessionId] : false);
  const quizzes = useQuizStore(state => state.quizzes);
  const loadQuizzes = useQuizStore(state => state.load);
  const isQuizLoading = useQuizStore(state => state.isLoading);
  const quiz = session ? quizzes.find(item => item.id === session.quizId) : undefined;
  const [pageError, setPageError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    if (!sessionId) {
      return () => { active = false; };
    }
    void Promise.all([
      open(sessionId),
      loadQuizzes().catch(() => undefined),
    ]).then(([outcome]) => {
      if (!active) return;
      if (outcome.status === 'completed') {
        navigate(`/student/practice/${sessionId}/result`, { replace: true });
      } else if (outcome.status === 'invalidated' || outcome.status === 'error') {
        setPageError(outcome.message);
      } else {
        setPageError(null);
      }
    });
    return () => { active = false; };
  }, [sessionId, open, loadQuizzes, navigate]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const questions = useMemo(() => {
    if (!session || !quiz) return [];
    return session.questionOrder.flatMap(questionId => {
      const question = quiz.questions.find(item => item.id === questionId);
      return question ? [question] : [];
    });
  }, [session, quiz]);
  const currentIndex = session?.currentQuestionIndex || 0;
  const currentQuestion = questions[currentIndex];
  const checked = currentQuestion && session ? session.checkedAnswers[currentQuestion.id] : undefined;
  const selectedAnswers = currentQuestion && session ? session.answers[currentQuestion.id] || [] : [];
  const checkedCount = session ? Object.keys(session.checkedAnswers).length : 0;
  const isChecking = usePracticeStore(state => session && currentQuestion
    ? state.checkingAnswers[`${session.id}:${currentQuestion.id}`]
    : false);
  const orderedOptions = useMemo(() => {
    if (!session || !currentQuestion) return [];
    const order = session.optionOrder[currentQuestion.id];
    if (!order?.length) return currentQuestion.options;
    return order.flatMap(optionId => {
      const option = currentQuestion.options.find(item => item.id === optionId);
      return option ? [option] : [];
    });
  }, [session, currentQuestion]);

  const elapsedSeconds = session && now > 0 ? Math.floor((now - new Date(session.startedAt).getTime()) / 1000) : 0;
  const quizNotAvailable = !!session && !quiz && !isLoading && !isQuizLoading;

  const handleCheck = async () => {
    if (!session || !currentQuestion) return;
    try {
      await checkAnswer(session.id, currentQuestion.id);
    } catch (error) {
      toast.error(practiceErrorMessage(error, 'Không thể kiểm tra câu trả lời. Vui lòng thử lại.'));
    }
  };

  const handleFinish = async () => {
    if (!session) return;
    try {
      await finish(session.id);
      navigate(`/student/practice/${session.id}/result`);
    } catch (error) {
      setPageError(practiceErrorMessage(error, 'Không thể hoàn tất lượt luyện tập. Vui lòng thử lại.'));
    }
  };

  const displayedError = pageError
    || (!sessionId ? 'Không tìm thấy mã lượt luyện tập. Hãy quay lại lịch sử luyện tập.' : null)
    || (quizNotAvailable ? 'Không tải được đề của lượt luyện tập. Hãy tải lại hoặc quay về lịch sử luyện tập.' : null);
  if (displayedError) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <ListChecks className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold text-neutral-900">Không thể tiếp tục lượt luyện</h1>
        <p className="text-sm text-neutral-600">{displayedError}</p>
        <Button variant="outline" onClick={() => navigate('/student/practice')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
          Về lịch sử luyện tập
        </Button>
      </div>
    );
  }

  if (isLoading || isQuizLoading || !session || !quiz) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-neutral-500">Đang mở lượt luyện tập…</div>;
  }

  if (quiz.status !== 'published' || quiz.settings.practiceEnabled === false || questions.length !== session.questionOrder.length) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
        <h1 className="text-xl font-bold text-neutral-900">Đề luyện tập đã thay đổi</h1>
        <p className="text-sm text-neutral-600">Giáo viên đã đóng hoặc chỉnh sửa đề. Lượt luyện dở không thể tiếp tục.</p>
        <Button variant="outline" onClick={() => navigate('/student/practice')}>Về lịch sử luyện tập</Button>
      </div>
    );
  }

  if (!currentQuestion) {
    return <div className="mx-auto max-w-xl py-16 text-center text-sm text-neutral-600">Không tìm thấy câu hỏi trong lượt luyện. Hãy quay lại lịch sử luyện tập.</div>;
  }

  const isFlagged = session.flaggedQuestionIds.includes(currentQuestion.id);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      <header className="flex flex-col gap-4 rounded-2xl border border-emerald-100 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="success" size="sm">Luyện tập</Badge>
            <Badge variant="secondary" size="sm">{session.subject}</Badge>
          </div>
          <h1 className="truncate text-lg font-bold text-neutral-900 sm:text-xl">{session.quizTitle}</h1>
          <p className="mt-1 text-xs text-neutral-500">Đã kiểm tra {checkedCount}/{questions.length} câu · Mỗi lần hiển thị một câu; câu chưa kiểm tra vẫn có thể sửa đáp án.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center justify-center gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-sm font-semibold tabular-nums text-neutral-700">
            <Clock3 className="h-4 w-4 text-emerald-700" />
            <span>Đã luyện {formatElapsed(elapsedSeconds)}</span>
          </div>
          <Button variant="outline" onClick={() => void handleFinish()} isLoading={isFinishing}>
            Hoàn tất lượt luyện
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <main className="space-y-4 lg:col-span-8">
          <QuestionFrame
            questionNumber={currentIndex + 1}
            questionCount={questions.length}
            headerMeta={checked && (
              <Badge variant={checked.isCorrect ? 'success' : 'destructive'} size="sm">
                {checked.isCorrect ? 'Chính xác' : 'Chưa chính xác'}
              </Badge>
            )}
            headerActions={(
              <Button
                size="sm"
                variant={isFlagged ? 'secondary' : 'outline'}
                className={isFlagged ? 'border-amber-300 bg-amber-50 text-amber-800' : ''}
                onClick={() => toggleFlag(session.id, currentQuestion.id)}
                leftIcon={<Flag className={isFlagged ? 'h-3.5 w-3.5 fill-current' : 'h-3.5 w-3.5'} />}
              >
                {isFlagged ? 'Bỏ cờ' : 'Đánh dấu'}
              </Button>
            )}
            prompt={<MathRenderer content={currentQuestion.content} />}
            feedback={(
              <>
                {checked && session.showExplanation && checked.explanation && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-900">Lời giải</p>
                    <div className="text-sm leading-6 text-sky-950"><MathRenderer content={checked.explanation} /></div>
                  </div>
                )}

                {checked && !session.showExplanation && (
                  <div className={checked.isCorrect
                    ? 'flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800'
                    : 'flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800'}>
                    <CheckCircle2 className="h-4 w-4" />
                    {checked.isCorrect ? 'Bạn đã chọn đúng.' : 'Câu này chưa đúng. Đáp án đúng đã được đánh dấu.'} Lời giải sẽ hiện ở kết quả.
                  </div>
                )}
              </>
            )}
            footer={(
              <div className="flex flex-col gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="outline"
                  disabled={currentIndex <= 0}
                  onClick={() => setQuestionIndex(session.id, currentIndex - 1)}
                  leftIcon={<ArrowLeft className="h-4 w-4" />}
                >
                  Câu trước
                </Button>
                {checked ? (
                  <Button
                    variant="primary"
                    onClick={() => currentIndex < questions.length - 1
                      ? setQuestionIndex(session.id, currentIndex + 1)
                      : void handleFinish()}
                    isLoading={isFinishing}
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                  >
                    {currentIndex < questions.length - 1 ? 'Câu tiếp theo' : 'Xem kết quả'}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => void handleCheck()}
                    disabled={selectedAnswers.length === 0}
                    isLoading={isChecking}
                    leftIcon={<Check className="h-4 w-4" />}
                  >
                    Kiểm tra câu này
                  </Button>
                )}
              </div>
            )}
          >
            {orderedOptions.map(option => {
              const isSelected = selectedAnswers.includes(option.id);
              const isCorrectOption = !!checked?.correctAnswers.includes(option.id);
              const isWrongSelection = !!checked && isSelected && !isCorrectOption;
              const style = checked
                ? isCorrectOption
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                  : isWrongSelection
                    ? 'border-rose-400 bg-rose-50 text-rose-950'
                    : 'border-neutral-200 bg-white text-neutral-500'
                : isSelected
                  ? 'border-blue-500 bg-blue-50 text-neutral-950'
                  : 'border-neutral-200 bg-white text-neutral-800 hover:border-blue-300 hover:bg-blue-50/40';
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!!checked}
                  aria-pressed={isSelected}
                  onClick={() => selectAnswer(session.id, currentQuestion.id, option.id as OptionId, currentQuestion.type === 'multiple_choice')}
                  className={'flex min-h-14 w-full items-start gap-3 rounded-xl border p-3.5 text-left transition sm:p-4 ' + style + ' disabled:cursor-default'}
                >
                  <span className={'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ' + (isSelected || isCorrectOption ? 'border-current' : 'border-neutral-300')}>
                    {checked && isCorrectOption ? <Check className="h-3.5 w-3.5" /> : option.id}
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-6"><MathRenderer content={option.content} /></span>
                  {isWrongSelection && <span className="text-xs font-semibold text-rose-700">Bạn chọn</span>}
                </button>
              );
            })}
          </QuestionFrame>
        </main>

        <aside className="space-y-4 lg:col-span-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="h-4 w-4 text-emerald-700" />Điều hướng câu hỏi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 lg:grid-cols-5">
                {session.questionOrder.map((questionId, index) => {
                  const answer = session.checkedAnswers[questionId];
                  const flagged = session.flaggedQuestionIds.includes(questionId);
                  const selected = (session.answers[questionId] || []).length > 0;
                  const color = answer
                    ? answer.isCorrect ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-rose-300 bg-rose-100 text-rose-900'
                    : flagged ? 'border-amber-300 bg-amber-50 text-amber-900'
                      : selected ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-neutral-200 bg-white text-neutral-700';
                  return (
                    <button
                      key={questionId}
                      type="button"
                      onClick={() => setQuestionIndex(session.id, index)}
                      className={`relative flex h-10 items-center justify-center rounded-lg border text-sm font-bold ${color} ${index === currentIndex ? 'ring-2 ring-emerald-600 ring-offset-1' : ''}`}
                      aria-label={`Chuyển đến câu ${index + 1}${flagged ? ', đã đánh dấu' : ''}${answer ? (answer.isCorrect ? ', đúng' : ', sai') : ''}`}
                    >
                      {index + 1}
                      {flagged && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Đúng</span>
                <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" />Sai</span>
                <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-blue-500" />Đã chọn</span>
                <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-500" />Đánh dấu</span>
              </div>
              <p className="text-xs text-neutral-500">Câu nhiều đáp án chỉ đúng khi bạn chọn đủ và đúng tất cả đáp án.</p>
            </CardContent>
          </Card>
          <Button variant="outline" className="w-full" onClick={() => void handleFinish()} isLoading={isFinishing}>
            Hoàn tất và xem kết quả
          </Button>
        </aside>
      </div>
    </div>
  );
}

export default PracticeRoom;
