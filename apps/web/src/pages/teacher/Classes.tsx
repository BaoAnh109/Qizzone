import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, BookOpen, Check, Copy, Plus, Users } from "lucide-react";
import type { Classroom } from "@qizzone/domain";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";

export function Classes() {
  const toast = useToast();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    classroomService.listMyClassrooms()
      .then((items) => {
        if (!cancelled) setClassrooms(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Không thể tải danh sách lớp học.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [toast]);

  const resetForm = () => {
    setName("");
    setSubject("");
    setGradeLevel("");
    setDescription("");
    setFormError("");
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedSubject = subject.trim();
    if (!trimmedName) {
      setFormError("Vui lòng nhập tên lớp.");
      return;
    }
    if (trimmedName.length > 120) {
      setFormError("Tên lớp không được vượt quá 120 ký tự.");
      return;
    }
    if (!trimmedSubject) {
      setFormError("Vui lòng nhập môn học.");
      return;
    }
    setFormError("");
    setIsSaving(true);
    try {
      const created = await classroomService.createClassroom({
        name: trimmedName,
        subject: trimmedSubject,
        gradeLevel: gradeLevel.trim(),
        description: description.trim(),
      });
      setClassrooms((current) => [created, ...current]);
      setShowArchived(false);
      setIsCreateOpen(false);
      resetForm();
      toast.success("Tạo lớp thành công.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Không thể tạo lớp học.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchiveToggle = async (classroom: Classroom) => {
    const nextArchived = !classroom.isArchived;
    const prompt = nextArchived ? `Lưu trữ lớp “${classroom.name}”?` : `Khôi phục lớp “${classroom.name}”?`;
    if (!window.confirm(prompt)) return;
    try {
      const updated = await classroomService.updateClassroom(classroom.id, { isArchived: nextArchived });
      setClassrooms((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success(nextArchived ? "Đã lưu trữ lớp học." : "Đã khôi phục lớp học.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật trạng thái lớp.");
    }
  };

  const handleCopyCode = async (classroom: Classroom) => {
    try {
      await navigator.clipboard.writeText(classroom.inviteCode);
      setCopiedCode(classroom.id);
      toast.success("Đã sao chép mã mời lớp học.");
      window.setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      toast.error("Không thể sao chép mã mời. Hãy chọn và sao chép mã thủ công.");
    }
  };

  const visibleClassrooms = classrooms.filter((classroom) => showArchived || !classroom.isArchived);
  const archivedCount = classrooms.filter((classroom) => classroom.isArchived).length;

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col gap-4 border-b theme-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">Giáo viên</p>
          <h1 className="page-heading mt-1">Quản lý lớp học</h1>
          <p className="page-description">Tạo lớp, quản lý danh sách học sinh và giao bài tập.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" aria-pressed={showArchived} onClick={() => setShowArchived((current) => !current)} leftIcon={<Archive className="h-4 w-4" />}>
            {showArchived ? "Ẩn lớp đã lưu trữ" : `Hiện lớp đã lưu trữ (${archivedCount})`}
          </Button>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
            Tạo lớp học
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Đang tải lớp học">
          {[0, 1, 2].map((item) => <Card key={item} aria-hidden="true"><CardContent className="space-y-4 p-5"><div className="h-5 w-2/3 animate-pulse rounded theme-surface-muted" /><div className="h-4 w-1/2 animate-pulse rounded theme-surface-muted" /><div className="h-12 animate-pulse rounded theme-surface-muted" /></CardContent></Card>)}
        </div>
      ) : visibleClassrooms.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <BookOpen className="mx-auto mb-3 h-9 w-9 theme-text-muted" aria-hidden="true" />
          <h2 className="font-semibold theme-text-primary">{showArchived && archivedCount === 0 ? "Chưa có lớp đã lưu trữ" : "Chưa có lớp học"}</h2>
          <p className="mt-1 text-sm theme-text-secondary">Tạo lớp đầu tiên để mời học sinh và giao bài.</p>
          <Button className="mt-4" variant="outline" onClick={() => setIsCreateOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
            Tạo lớp học
          </Button>
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleClassrooms.map((classroom) => (
            <Card key={classroom.id} hoverEffect className={`flex h-full flex-col ${classroom.isArchived ? "opacity-80" : ""}`}>
              <CardContent className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/teacher/classes/${classroom.id}`} className="rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
                      <h2 className="truncate text-lg font-bold theme-text-primary">{classroom.name}</h2>
                    </Link>
                    {classroom.isArchived && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Đã lưu trữ</span>}
                  </div>
                  <div className="flex max-w-[50%] flex-wrap justify-end gap-1.5">
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">{classroom.subject || "Chưa có môn"}</span>
                    {classroom.gradeLevel && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">Khối {classroom.gradeLevel}</span>}
                  </div>
                </div>
                {classroom.description && <p className="line-clamp-2 text-sm theme-text-secondary">{classroom.description}</p>}
                <div className="flex flex-wrap gap-4 text-sm theme-text-secondary">
                  <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" aria-hidden="true" />{classroom.memberCount} học sinh</span>
                  <span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4" aria-hidden="true" />{classroom.assignmentCount} bài tập</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg theme-surface-muted px-3 py-2">
                  <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide theme-text-muted">Mã mời</p><p className="truncate font-mono text-sm font-bold tracking-wider theme-text-primary">{classroom.inviteCode}</p></div>
                  <Button type="button" variant="ghost" aria-label={`Sao chép mã mời ${classroom.name}`} onClick={() => void handleCopyCode(classroom)} className="min-h-11 min-w-11 px-2">
                    {copiedCode === classroom.id ? <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                </div>
                <div className="mt-auto flex flex-wrap gap-2 border-t theme-border pt-3">
                  <Link to={`/teacher/classes/${classroom.id}`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">Vào lớp</Link>
                  <Button variant="outline" onClick={() => void handleArchiveToggle(classroom)}>{classroom.isArchived ? "Khôi phục" : "Lưu trữ"}</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); resetForm(); }}
        title="Tạo lớp học"
        description="Nhập thông tin cơ bản. Có thể cập nhật cài đặt lớp sau."
        footer={<>
          <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>Hủy</Button>
          <Button variant="primary" onClick={handleCreate} isLoading={isSaving}>Tạo lớp</Button>
        </>}
      >
        <div className="space-y-4">
          <Input label="Tên lớp *" value={name} maxLength={160} required onChange={(event) => { setName(event.target.value); setFormError(""); }} error={formError && !name.trim() ? formError : undefined} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Môn học *" value={subject} maxLength={100} required onChange={(event) => { setSubject(event.target.value); setFormError(""); }} />
            <Input label="Khối" value={gradeLevel} maxLength={50} onChange={(event) => setGradeLevel(event.target.value)} />
          </div>
          <Textarea label="Mô tả" value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} />
          {formError && <p role="alert" className="text-sm font-medium text-status-danger">{formError}</p>}
        </div>
      </Modal>
    </div>
  );
}

export default Classes;
