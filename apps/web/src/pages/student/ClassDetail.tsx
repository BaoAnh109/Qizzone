import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CalendarClock, GraduationCap, Play, Users } from "lucide-react";
import type { Classroom, StudentAssignmentItem } from "@qizzone/domain";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";

function formatDate(value: string | null): string {
  if (!value) return "Chưa đặt";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function countdown(value: string | null): string | null {
  if (!value) return null;
  const remaining = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  if (hours < 24) return `Còn ${hours} giờ`;
  return `Còn ${Math.ceil(hours / 24)} ngày`;
}

function statusFor(item: StudentAssignmentItem): { label: string; className: string } {
  if (item.status === "completed" && item.isLate) return { label: "Nộp muộn", className: "bg-amber-100 text-amber-900" };
  if (item.status === "completed") return { label: "Đã hoàn thành", className: "bg-blue-100 text-blue-900" };
  if (item.status === "overdue") return { label: "Quá hạn", className: "bg-rose-100 text-rose-900" };
  return { label: "Cần làm", className: "bg-emerald-100 text-emerald-900" };
}

function canStart(item: StudentAssignmentItem): boolean {
  if (item.status === "completed") return false;
  if (item.hardCloseAt && new Date(item.hardCloseAt).getTime() <= Date.now()) return false;
  if (item.status === "overdue" && item.latePolicy === "block_after_due") return false;
  return true;
}

export function ClassDetail() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<StudentAssignmentItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classId) return undefined;
    let cancelled = false;
    Promise.all([
      classroomService.getClassroomDetail(classId),
      classroomService.listStudentAssignments(classId),
    ])
      .then(([detail, items]) => {
        if (cancelled) return;
        setClassroom(detail.classroom);
        setAssignments(items);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          const message = reason instanceof Error ? reason.message : "";
          setError(`Không có quyền xem lớp học hoặc không tìm thấy lớp. ${message}`.trim());
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [classId]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  if (loading) return <Card><CardContent className="p-6 text-sm theme-text-secondary">Đang tải lớp học…</CardContent></Card>;
  if (error || !classroom) return <div className="space-y-4"><Link to="/student/classes" className="inline-flex min-h-11 items-center gap-2 font-semibold text-blue-700"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Lớp học của tôi</Link><Card><CardContent className="p-6 text-sm theme-text-secondary">{error || "Không tìm thấy lớp học."}</CardContent></Card></div>;

  const classAssignments = assignments.filter((assignment) => assignment.classroomId === classroom.id);

  return (
    <div className="space-y-6 pb-16">
      <Link to="/student/classes" className="inline-flex min-h-11 items-center gap-2 font-semibold text-blue-700 hover:text-blue-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Lớp học của tôi</Link>
      <header className="rounded-2xl border theme-border theme-surface p-5 sm:p-6">
        <p className="text-sm font-medium text-blue-700">Chi tiết lớp học</p>
        <h1 className="page-heading mt-1">{classroom.name}</h1>
        <p className="mt-1 text-sm theme-text-secondary">{classroom.subject || "Chưa có môn học"}{classroom.gradeLevel ? ` · Khối ${classroom.gradeLevel}` : ""}</p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm theme-text-secondary"><span className="inline-flex items-center gap-1.5"><GraduationCap className="h-4 w-4" aria-hidden="true" />Giáo viên: {classroom.teacherName || "Giáo viên"}</span><span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" aria-hidden="true" />{classroom.memberCount} thành viên</span></div>
      </header>

      <section className="space-y-4" aria-labelledby="class-assignments-heading">
        <div className="flex items-end justify-between gap-3"><div><h2 id="class-assignments-heading" className="text-lg font-bold theme-text-primary">Bài tập của lớp</h2><p className="text-sm theme-text-secondary">Theo dõi tình trạng và hạn nộp của bạn.</p></div><span className="text-sm theme-text-muted">{classAssignments.length} bài</span></div>
        {classAssignments.length === 0 ? <Card><CardContent className="p-8 text-center"><BookOpen className="mx-auto mb-3 h-9 w-9 theme-text-muted" aria-hidden="true" /><h3 className="font-semibold theme-text-primary">Chưa có bài tập</h3><p className="mt-1 text-sm theme-text-secondary">Bài giáo viên giao sẽ xuất hiện ở đây.</p></CardContent></Card> : <div className="space-y-3">{classAssignments.map((item) => {
          const status = statusFor(item);
          const startable = canStart(item);
          const dueCountdown = countdown(item.dueAt);
          const title = item.title || item.quizTitle || "Bài tập";
          return <Card key={item.assignmentId} className="overflow-hidden"><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold theme-text-primary">{title}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span></div>
              {item.instructions && <p className="text-sm theme-text-secondary">{item.instructions}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs theme-text-muted"><span>Hạn nộp: {formatDate(item.dueAt)}</span>{dueCountdown && item.status !== "completed" && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{dueCountdown}</span>}{item.status === "overdue" && item.latePolicy === "allow_late" && <span>Giáo viên vẫn cho phép nộp muộn.</span>}</div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {item.status === "completed" ? item.latestResultId ? <Link to={`/student/result/${item.latestResultId}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 px-4 text-sm font-semibold text-blue-800 hover:bg-blue-50">Xem kết quả</Link> : <span className="inline-flex min-h-11 items-center px-3 text-sm theme-text-muted">Đã nộp bài</span> : startable ? <Button variant="primary" onClick={() => navigate(`/student/quiz/${item.quizId}/lobby?assignmentId=${encodeURIComponent(item.assignmentId)}`)} leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}>{item.status === "overdue" ? "Làm bài muộn" : "Làm bài"}</Button> : <span className="inline-flex min-h-11 items-center rounded-lg bg-rose-50 px-3 text-sm font-medium text-rose-800">Bài đã đóng</span>}
            </div>
          </CardContent></Card>;
        })}</div>}
      </section>
    </div>
  );
}

export default ClassDetail;
