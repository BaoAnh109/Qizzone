import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Check, CircleHelp, Shuffle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { useQuizStore } from '@/store/quizStore';
import { usePracticeStore } from '@/store/practiceStore';
import { practiceErrorMessage } from '@/utils/practice';

export function PracticeSetup() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const quizzes = useQuizStore(state => state.quizzes);
  const loadQuizzes = useQuizStore(state => state.load);
  const isQuizzesLoading = useQuizStore(state => state.isLoading);
  const quizError = useQuizStore(state => state.error);
  const quiz = quizzes.find(item => item.id === quizId);
  const start = usePracticeStore(state => state.start);
  const isStarting = usePracticeStore(state => state.isStarting);
  const [randomCountEnabled, setRandomCountEnabled] = useState(false);
  const [questionCount, setQuestionCount] = useState(1);
  const [showExplanation, setShowExplanation] = useState(true);

  useEffect(() => {
    void loadQuizzes().catch(() => {});
  }, [loadQuizzes]);

  const totalQuestions = quiz?.totalQuestions || quiz?.questions.length || 0;
  const isAvailable = quiz?.status === 'published' && quiz.settings.practiceEnabled !== false;
  const invalidMessage = !quiz
    ? 'Không tìm thấy đề. Đề có thể đã bị xóa hoặc không còn được chia sẻ.'
    : quiz.status !== 'published'
      ? 'Đề chưa được xuất bản hoặc đã đóng bởi giáo viên.'
      : 'Giáo viên đã tắt chức năng luyện tập cho đề này.';
  const unavailableMessage = !quiz && quizError
    ? 'Không tải được đề luyện tập. Vui lòng thử lại sau.'
    : invalidMessage;

  const handleStart = async () => {
    if (!quiz || !isAvailable) return;
    if (totalQuestions < 1) {
      toast.error('Đề chưa có câu hỏi để luyện tập.');
      return;
    }
    if (randomCountEnabled && (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > totalQuestions)) {
      toast.error(`Số câu phải từ 1 đến ${totalQuestions}.`);
      return;
    }
    try {
      const session = await start(quiz.id, randomCountEnabled ? questionCount : null, showExplanation);
      navigate(`/student/practice/${session.id}/room`);
    } catch (error) {
      toast.error(practiceErrorMessage(error, 'Không thể bắt đầu lượt luyện tập. Vui lòng thử lại.'));
    }
  };

  if (isQuizzesLoading && !quiz) {
    return <div className="mx-auto max-w-2xl py-16 text-center text-sm theme-text-muted">Đang tải đề luyện tập…</div>;
  }

  if (!isAvailable) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <CircleHelp className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold theme-text-primary">Không thể luyện tập đề này</h1>
        <p className="text-sm theme-text-secondary">{unavailableMessage}</p>
        <Button variant="outline" onClick={() => navigate('/student')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
          Về trang học sinh
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <Button variant="ghost" size="sm" onClick={() => navigate('/student')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
        Về trang học sinh
      </Button>
      <Card className="overflow-hidden">
        <CardHeader className="bg-emerald-50/70">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="success" size="sm">{quiz.subject}</Badge>
            <Badge variant="secondary" size="sm">{totalQuestions} câu hỏi</Badge>
          </div>
          <CardTitle className="text-2xl font-bold">{quiz.title}</CardTitle>
          {quiz.description && <p className="pt-1 text-sm theme-text-secondary">{quiz.description}</p>}
        </CardHeader>
        <CardContent className="space-y-6 p-5 sm:p-7">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${!randomCountEnabled ? 'border-emerald-500 bg-emerald-50/60' : 'theme-border'}`}>
              <input type="radio" name="practice-question-count" checked={!randomCountEnabled} onChange={() => setRandomCountEnabled(false)} className="mt-1 accent-emerald-700" />
              <span>
                <span className="block text-sm font-semibold theme-text-primary">Luyện toàn bộ câu hỏi</span>
                <span className="mt-1 block text-xs theme-text-muted">Làm đủ {totalQuestions} câu của đề.</span>
              </span>
            </label>
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${randomCountEnabled ? 'border-emerald-500 bg-emerald-50/60' : 'theme-border'}`}>
              <input type="radio" name="practice-question-count" checked={randomCountEnabled} onChange={() => setRandomCountEnabled(true)} className="mt-1 accent-emerald-700" />
              <span>
                <span className="block text-sm font-semibold theme-text-primary">Chọn số câu ngẫu nhiên</span>
                <span className="mt-1 block text-xs theme-text-muted">Hệ thống chọn ngẫu nhiên trong đề.</span>
              </span>
            </label>
          </div>

          {randomCountEnabled && (
            <div className="max-w-xs space-y-1.5">
              <label htmlFor="practice-question-count" className="text-sm font-semibold theme-text-secondary">Số câu muốn luyện</label>
              <input
                id="practice-question-count"
                type="number"
                min={1}
                max={totalQuestions}
                value={questionCount}
                onChange={event => setQuestionCount(Number(event.target.value))}
                className="h-11 w-full rounded-lg border theme-border-strong px-3 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
              <p className="text-xs theme-text-muted">Chọn từ 1 đến {totalQuestions} câu.</p>
            </div>
          )}

          <div className="space-y-3 border-t theme-border pt-5">
            <h2 className="text-sm font-bold theme-text-primary">Cách luyện tập</h2>
            <div className="flex items-start gap-3 rounded-xl theme-surface-muted p-4">
              <Shuffle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <p className="text-sm theme-text-secondary">Thứ tự câu hỏi và đáp án sẽ theo cài đặt xáo trộn của đề.</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border theme-border p-4">
              <input
                type="checkbox"
                checked={showExplanation}
                onChange={event => setShowExplanation(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-700"
              />
              <span>
                <span className="block text-sm font-semibold theme-text-primary">Hiện lời giải ngay sau khi kiểm tra mỗi câu</span>
                <span className="mt-1 block text-xs theme-text-muted">{showExplanation ? 'Đang bật' : 'Lời giải sẽ hiện ở trang kết quả.'}</span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t theme-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs theme-text-muted">
              <BookOpen className="h-4 w-4 text-emerald-700" />
              Không giới hạn lượt, không đếm ngược và không tính điểm thi.
            </div>
            <Button
              size="lg"
              className="shrink-0 bg-emerald-700 hover:bg-emerald-800"
              isLoading={isStarting}
              leftIcon={<Check className="h-4 w-4" />}
              onClick={() => void handleStart()}
            >
              Bắt đầu luyện tập
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default PracticeSetup;
