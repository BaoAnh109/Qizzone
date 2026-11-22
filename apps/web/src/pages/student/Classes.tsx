import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2, GraduationCap, Plus, Users } from "lucide-react";
import type { Classroom, StudentAssignmentItem } from "@qizzone/domain";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";

function getJoinError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Không thể tham gia lớp học. Vui lòng thử lại.";
  if (/không tìm thấy lớp/i.test(message)) return "Không tìm thấy lớp học. Hãy kiểm tra lại mã lớp.";
  if (/tạm tắt lời mời/i.test(message)) return "Giáo viên đã tạm tắt lời mời tham gia lớp học này.";
  if (/đã được lưu trữ/i.test(message)) return "Lớp học này đã được lưu trữ.";
  return message;
}

export function Classes() {
  const toast = useToast();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<StudentAssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      classroomService.listMyClassrooms(),
      classroomService.listStudentAssignments(),
    ])
      .then(([items, assignmentItems]) => {
        if (cancelled) return;
        setClassrooms(items.filter((item) => !item.isArchived));
        setAssignments(assignmentItems);
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Không thể tải lớp học.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [toast]);

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError("Nhập mã lớp để tham gia.");
      return;
    }
    setJoinError("");
    setIsJoining(true);
    try {
      const classroom = await classroomService.joinByCode(code, "code");
      setClassrooms((current) => [classroom, ...current.filter((item) => item.id !== classroom.id)]);
      const refreshedAssignments = await classroomService.listStudentAssignments().catch(() => assignments);
      setAssignments(refreshedAssignments);
      setJoinCode("");
      setIsJoinModalOpen(false);
      toast.success("Đã tham gia lớp thành công.");
    } catch (error) {
      setJoinError(getJoinError(error));
    } finally {
      setIsJoining(false);
    }
  };

  const openJoinModal = () => {
    setJoinError("");
    setIsJoinModalOpen(true);
  };

  const pendingForClass = (classroomId: string) => assignments.filter((item) => item.classroomId === classroomId && item.status !== "completed").length;

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-col gap-4 border-b theme-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">Cổng học sinh</p>
          <h1 className="page-heading mt-1">Lớp học của tôi</h1>
          <p className="page-description">Xem lớp đã tham gia, bài tập và hạn nộp.</p>
        </div>
        <Button variant="outline" onClick={openJoinModal} leftIcon={<Plus className="h-4 w-4" />}>Mở cửa sổ nhập mã</Button>
      </header>

      <Card><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5">
        <div className="flex-1"><h2 className="font-semibold theme-text-primary">Tham gia lớp bằng mã</h2><p className="mt-1 text-sm theme-text-secondary">Nhập mã mời do giáo viên cung cấp.</p></div>
        <form className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row" onSubmit={(event) => { event.preventDefault(); void handleJoin(); }}>
          <Input aria-label="Mã lớp" placeholder="Nhập mã lớp..." value={joinCode} onChange={(event) => { setJoinCode(event.target.value.toUpperCase()); setJoinError(""); }} className="sm:w-64" />
          <Button type="submit" variant="primary" isLoading={isJoining}>Tham gia lớp</Button>
        </form>
      </CardContent></Card>
      {joinError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{joinError}</p>}

      <section className="space-y-4" aria-labelledby="my-classes-heading">
        <div className="flex items-end justify-between gap-3"><div><h2 id="my-classes-heading" className="text-lg font-bold theme-text-primary">Các lớp đã tham gia</h2><p className="text-sm theme-text-secondary">Bài tập và thông tin lớp được cá nhân hóa cho bạn.</p></div><span className="text-sm theme-text-muted">{classrooms.length} lớp</span></div>
        {loading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Đang tải lớp học">{[0, 1, 2].map((item) => <Card key={item} aria-hidden="true"><CardContent className="space-y-4 p-5"><div className="h-5 w-2/3 animate-pulse rounded theme-surface-muted" /><div className="h-4 w-1/2 animate-pulse rounded theme-surface-muted" /><div className="h-12 animate-pulse rounded theme-surface-muted" /></CardContent></Card>)}</div>
          : classrooms.length === 0 ? <Card><CardContent className="p-8 text-center"><GraduationCap className="mx-auto mb-3 h-9 w-9 theme-text-muted" aria-hidden="true" /><h3 className="font-semibold theme-text-primary">Bạn chưa tham gia lớp nào</h3><p className="mt-1 text-sm theme-text-secondary">Nhập mã mời ở trên để vào lớp của giáo viên.</p></CardContent></Card>
            : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{classrooms.map((classroom) => {
              const pendingCount = pendingForClass(classroom.id);
              return <Card key={classroom.id} hoverEffect className="flex h-full flex-col"><CardContent className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-lg font-bold theme-text-primary"><Link to={`/student/classes/${classroom.id}`} className="focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">{classroom.name}</Link></h3><p className="mt-1 text-sm theme-text-secondary">{classroom.subject || "Chưa có môn học"}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${pendingCount > 0 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{pendingCount > 0 ? `${pendingCount} bài cần làm` : "Đã hoàn thành"}</span></div>
                <p className="text-sm theme-text-secondary">Giáo viên: {classroom.teacherName || "Giáo viên"}</p>
                <div className="flex flex-wrap gap-4 text-sm theme-text-secondary"><span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" aria-hidden="true" />{classroom.memberCount} thành viên</span><span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4" aria-hidden="true" />{classroom.assignmentCount} bài tập</span></div>
                {pendingCount === 0 && <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Bạn đã hoàn tất các bài tập đang có.</p>}
                <Link to={`/student/classes/${classroom.id}`} className="mt-auto inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">Vào lớp</Link>
              </CardContent></Card>;
            })}</div>}
      </section>

      <Modal isOpen={isJoinModalOpen} onClose={() => { setIsJoinModalOpen(false); setJoinError(""); }} title="Tham gia lớp" description="Nhập mã mời do giáo viên cung cấp." footer={<><Button variant="outline" onClick={() => setIsJoinModalOpen(false)}>Đóng</Button><Button variant="primary" onClick={() => void handleJoin()} isLoading={isJoining}>Tham gia lớp</Button></>}>
        <div className="space-y-3"><Input label="Mã lớp" placeholder="VD: CLS123" value={joinCode} onChange={(event) => { setJoinCode(event.target.value.toUpperCase()); setJoinError(""); }} />{joinError && <p role="alert" className="text-sm font-medium text-rose-800">{joinError}</p>}</div>
      </Modal>
    </div>
  );
}

export default Classes;
