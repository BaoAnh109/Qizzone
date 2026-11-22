import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, FileSpreadsheet, KeyRound, Pencil, RefreshCw, Settings, Users } from "lucide-react";
import type { ClassroomAssignment, ClassroomDetail, ClassroomMember } from "@qizzone/domain";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";
import { parseRosterImportFile, type RosterImportParseResult } from "@/utils/excelRosterImport";

type DetailTab = "students" | "assignments" | "settings";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Chưa đặt";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function visibleMembers(members: ClassroomMember[]) {
  return members.filter((member) => member.status !== "removed");
}

function assignmentStatus(assignment: ClassroomAssignment): string {
  const now = Date.now();
  if (assignment.availableFrom && new Date(assignment.availableFrom).getTime() > now) return "Sắp diễn ra";
  const closeAt = assignment.hardCloseAt ?? (assignment.latePolicy === "block_after_due" ? assignment.dueAt : null);
  if (closeAt && new Date(closeAt).getTime() <= now) return "Đã đóng";
  return "Đang mở";
}

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  return source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "HS";
}

export function ClassDetail() {
  const { classId: classroomId } = useParams();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<ClassroomDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<DetailTab>("students");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [memberEmails, setMemberEmails] = useState("");
  const [importPreview, setImportPreview] = useState<RosterImportParseResult | null>(null);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    if (!classroomId) return undefined;
    let cancelled = false;
    classroomService.getClassroomDetail(classroomId)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setLoadError("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? `Không có quyền xem lớp học hoặc không tìm thấy lớp. ${error.message}` : "Không có quyền xem lớp học hoặc không tìm thấy lớp.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [classroomId]);

  const refreshDetail = async () => {
    if (!classroomId) return;
    const refreshed = await classroomService.getClassroomDetail(classroomId);
    setDetail(refreshed);
  };

  const openEdit = () => {
    if (!detail) return;
    setEditName(detail.classroom.name);
    setEditSubject(detail.classroom.subject || "");
    setEditGrade(detail.classroom.gradeLevel || "");
    setEditDescription(detail.classroom.description || "");
    setIsEditOpen(true);
  };

  const handleSaveClass = async () => {
    if (!detail || !classroomId) return;
    const nextName = editName.trim();
    if (!nextName || nextName.length > 120) {
      toast.error("Tên lớp phải có từ 1 đến 120 ký tự.");
      return;
    }
    setSaving(true);
    try {
      const classroom = await classroomService.updateClassroom(classroomId, {
        name: nextName,
        subject: editSubject.trim(),
        gradeLevel: editGrade.trim(),
        description: editDescription.trim(),
      });
      setDetail((current) => current ? { ...current, classroom } : current);
      setIsEditOpen(false);
      toast.success("Đã cập nhật lớp học.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật lớp học.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleInvite = async () => {
    if (!detail || !classroomId) return;
    const inviteEnabled = !detail.classroom.inviteEnabled;
    try {
      const classroom = await classroomService.updateClassroom(classroomId, { inviteEnabled });
      setDetail((current) => current ? { ...current, classroom } : current);
      toast.success(inviteEnabled ? "Đã bật mã mời tham gia lớp." : "Đã tắt mã mời tham gia lớp.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật cài đặt mã mời.");
    }
  };

  const handleRegenerateCode = async () => {
    if (!detail || !classroomId || !window.confirm("Đổi mã mời của lớp? Mã cũ sẽ không còn sử dụng được.")) return;
    try {
      const inviteCode = await classroomService.regenerateInviteCode(classroomId);
      setDetail((current) => current ? { ...current, classroom: { ...current.classroom, inviteCode } } : current);
      toast.success("Đã tạo mã mời mới.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể đổi mã mời.");
    }
  };

  const handleArchiveToggle = async () => {
    if (!detail || !classroomId) return;
    const nextArchived = !detail.classroom.isArchived;
    const prompt = nextArchived ? "Lưu trữ lớp học này? Học sinh sẽ không thể tham gia lớp bằng mã mời." : "Khôi phục lớp học này?";
    if (!window.confirm(prompt)) return;
    try {
      const classroom = await classroomService.updateClassroom(classroomId, { isArchived: nextArchived });
      setDetail((current) => current ? { ...current, classroom } : current);
      toast.success(nextArchived ? "Đã lưu trữ lớp học." : "Đã khôi phục lớp học.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể lưu trữ lớp học.");
    }
  };

  const handleAddMembers = async (emails: string[], joinedVia: "teacher_email" | "excel_import") => {
    if (!classroomId || emails.length === 0) {
      toast.error("Vui lòng nhập ít nhất một địa chỉ email hợp lệ.");
      return false;
    }
    setSaving(true);
    try {
      const result = await classroomService.addMembersBulk({ classroomId, emails, joinedVia });
      await refreshDetail();
      toast.success(`Đã thêm ${result.addedActive + result.addedPending} email vào lớp${result.skippedExisting ? `; bỏ qua ${result.skippedExisting} email đã có` : ""}.`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể thêm học sinh vào lớp.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAddTypedEmails = async () => {
    const emails = Array.from(new Set(memberEmails.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean)));
    if (await handleAddMembers(emails, "teacher_email")) {
      setIsAddOpen(false);
      setMemberEmails("");
    }
  };

  const handleFileChange = async (file?: File) => {
    setImportError("");
    setImportPreview(null);
    if (!file) return;
    try {
      const parsed = await parseRosterImportFile(file);
      setImportPreview(parsed);
      if (parsed.emails.length === 0) setImportError("Không tìm thấy email hợp lệ trong tệp.");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Không thể đọc tệp danh sách học sinh.");
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    if (await handleAddMembers(importPreview.emails, "excel_import")) {
      setImportPreview(null);
      setImportError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveMember = async (member: ClassroomMember) => {
    if (!classroomId || !window.confirm(`Xóa ${member.invitedEmail} khỏi lớp?`)) return;
    try {
      await classroomService.removeMember(classroomId, member.id);
      await refreshDetail();
      toast.success("Đã xóa học sinh khỏi lớp.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể xóa học sinh khỏi lớp.");
    }
  };

  if (loading) return <Card><CardContent className="p-6 text-sm theme-text-secondary">Đang tải lớp học…</CardContent></Card>;
  if (loadError || !detail) return (
    <div className="space-y-4">
      <Link to="/teacher/classes" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Quay lại lớp học</Link>
      <Card><CardContent className="p-6 text-sm theme-text-secondary">{loadError || "Không tìm thấy lớp học."}</CardContent></Card>
    </div>
  );

  const { classroom, members, assignments } = detail;
  const activeMembers = visibleMembers(members);
  const tabs: Array<{ id: DetailTab; label: string; icon: typeof Users }> = [
    { id: "students", label: "Học sinh", icon: Users },
    { id: "assignments", label: "Bài tập", icon: BookOpen },
    { id: "settings", label: "Cài đặt", icon: Settings },
  ];

  return (
    <div className="space-y-6 pb-16">
      <Link to="/teacher/classes" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Lớp học</Link>
      <header className="flex flex-col gap-4 border-b theme-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-heading">{classroom.name}</h1>
            {classroom.isArchived && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Đã lưu trữ</span>}
          </div>
          <p className="mt-1 text-sm theme-text-secondary">{[classroom.subject, classroom.gradeLevel && `Khối ${classroom.gradeLevel}`].filter(Boolean).join(" · ") || "Lớp học của bạn"}</p>
        </div>
        <Button variant="outline" onClick={openEdit} leftIcon={<Pencil className="h-4 w-4" />}>Chỉnh sửa lớp</Button>
      </header>

      <Card><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wide theme-text-muted">Mã mời vào lớp</p><p className="mt-1 font-mono text-xl font-bold tracking-wider theme-text-primary">{classroom.inviteCode}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-h-11 items-center gap-2 rounded-lg border theme-border px-3">
            <span className="text-xs font-medium theme-text-secondary">Cho phép tham gia</span>
            <button type="button" role="switch" aria-label="Cho phép tham gia bằng mã mời" aria-checked={classroom.inviteEnabled} onClick={() => void handleToggleInvite()} className="relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"><span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition ${classroom.inviteEnabled ? "bg-emerald-600" : "bg-neutral-400"}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${classroom.inviteEnabled ? "translate-x-5" : "translate-x-0"}`} /></span></button>
          </div>
          <Button variant="outline" onClick={handleRegenerateCode} leftIcon={<RefreshCw className="h-4 w-4" />}>Đổi mã mời</Button>
          <Button variant="outline" onClick={handleArchiveToggle}>{classroom.isArchived ? "Khôi phục lớp" : "Lưu trữ lớp"}</Button>
        </div>
      </CardContent></Card>

      <div className="flex gap-1 overflow-x-auto border-b theme-border" role="tablist" aria-label="Nội dung lớp học">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition ${tab === id ? "border-blue-700 text-blue-800" : "border-transparent theme-text-secondary hover:theme-text-primary"}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />{label}{id === "students" ? ` (${activeMembers.length})` : id === "assignments" ? ` (${assignments.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "students" && <section role="tabpanel" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-lg font-semibold theme-text-primary">Danh sách học sinh</h2><p className="text-sm theme-text-secondary">Học sinh chưa đăng ký sẽ được mời bằng email.</p></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setIsAddOpen(true)} leftIcon={<Users className="h-4 w-4" />}>Thêm học sinh</Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} leftIcon={<FileSpreadsheet className="h-4 w-4" />}>Nhập danh sách Excel</Button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Tệp danh sách học sinh" onChange={(event) => void handleFileChange(event.target.files?.[0])} />
          </div>
        </div>
        {importError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{importError}</p>}
        {importPreview && <Card><CardContent className="space-y-3 p-4">
          <div><h3 className="font-semibold theme-text-primary">Xem trước danh sách nhập</h3><p className="text-sm theme-text-secondary">{importPreview.emails.length} email hợp lệ · {importPreview.duplicateCount} email trùng · {importPreview.invalidEntries.length} mục không hợp lệ</p></div>
          <ul className="max-h-44 space-y-1 overflow-y-auto text-sm theme-text-primary">{importPreview.emails.map((email) => <li key={email}>{email}</li>)}</ul>
          {importPreview.invalidEntries.length > 0 && <p className="text-xs theme-text-muted">Bỏ qua: {importPreview.invalidEntries.slice(0, 5).join(", ")}</p>}
          <Button variant="primary" onClick={() => void handleConfirmImport()} isLoading={saving} disabled={importPreview.emails.length === 0}>Xác nhận nhập {importPreview.emails.length} email</Button>
        </CardContent></Card>}
        {activeMembers.length === 0 ? <Card><CardContent className="p-8 text-center text-sm theme-text-secondary">Chưa có học sinh trong lớp.</CardContent></Card> : <div className="overflow-x-auto rounded-xl border theme-border">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="theme-surface-muted theme-text-secondary"><tr><th className="px-4 py-3 font-semibold">Học sinh / Email</th><th className="px-4 py-3 font-semibold">Trạng thái</th><th className="px-4 py-3 font-semibold">Nguồn tham gia</th><th className="px-4 py-3 font-semibold">Ngày tham gia</th><th className="px-4 py-3 text-right font-semibold">Thao tác</th></tr></thead>
            <tbody className="divide-y theme-border">{activeMembers.map((member) => <tr key={member.id}>
              <td className="px-4 py-3"><div className="flex items-center gap-3"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">{initials(member.memberName, member.invitedEmail)}</span><div><div className="font-medium theme-text-primary">{member.memberName || member.invitedEmail}</div>{member.memberName && <div className="text-xs theme-text-muted">{member.invitedEmail}</div>}</div></div></td>
              <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${member.status === "active" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{member.status === "active" ? "Đang học" : "Đang chờ lời mời"}</span></td>
              <td className="px-4 py-3 theme-text-secondary">{member.joinedVia === "teacher_email" ? "Giáo viên thêm" : member.joinedVia === "excel_import" ? "Nhập Excel" : member.joinedVia === "link" ? "Đường dẫn" : "Mã mời"}</td>
              <td className="px-4 py-3 theme-text-secondary">{formatDate(member.joinedAt || member.createdAt)}</td>
              <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => void handleRemoveMember(member)} className="min-h-11 text-rose-700">Xóa</Button></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>}

      {tab === "assignments" && <section role="tabpanel" className="space-y-4">
        <div><h2 className="text-lg font-semibold theme-text-primary">Bài tập đã giao</h2><p className="text-sm theme-text-secondary">Theo dõi hạn nộp và chính sách làm bài của lớp.</p></div>
        {assignments.length === 0 ? <Card><CardContent className="p-8 text-center text-sm theme-text-secondary">Lớp chưa có bài tập được giao.</CardContent></Card> : <div className="space-y-3">{assignments.map((assignment) => <Card key={assignment.id}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div><h3 className="font-semibold theme-text-primary">{assignment.title || assignment.quizTitle || "Bài tập"}</h3><p className="mt-1 text-sm theme-text-secondary">{assignment.instructions || assignment.quizTitle || ""}</p><p className="mt-1 text-xs theme-text-muted">Đã giao: {formatDate(assignment.createdAt)}</p><Link className="mt-3 inline-flex min-h-11 items-center font-semibold text-blue-700 hover:text-blue-900" to={`/teacher/quiz/${assignment.quizId}/results?classroomId=${encodeURIComponent(classroom.id)}`}>Xem kết quả</Link></div>
          <div className="shrink-0 space-y-1 text-sm theme-text-secondary"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${assignmentStatus(assignment) === "Đã đóng" ? "bg-neutral-100 text-neutral-800" : assignmentStatus(assignment) === "Sắp diễn ra" ? "bg-blue-100 text-blue-900" : "bg-emerald-100 text-emerald-900"}`}>{assignmentStatus(assignment)}</span><div>Hạn nộp: {formatDate(assignment.dueAt)}</div><div>Chính sách: {assignment.latePolicy === "allow_late" ? "Cho phép nộp muộn" : "Chặn sau hạn"}</div></div>
        </CardContent></Card>)}</div>}
      </section>}

      {tab === "settings" && <section role="tabpanel" className="space-y-4">
        <Card><CardContent className="space-y-5 p-5">
          <div><h2 className="text-lg font-semibold theme-text-primary">Cài đặt lớp</h2><p className="text-sm theme-text-secondary">Quản lý thông tin và quyền tham gia lớp.</p></div>
          <div className="rounded-xl border theme-border p-4"><p className="font-semibold theme-text-primary">Mã mời {classroom.inviteEnabled ? "đang bật" : "đang tắt"}</p><p className="text-sm theme-text-secondary">{classroom.inviteEnabled ? "Học sinh có thể tham gia bằng mã mời." : "Học sinh mới chưa thể tham gia bằng mã mời."} Thay đổi nhanh bằng công tắc ở đầu trang.</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={openEdit} leftIcon={<Pencil className="h-4 w-4" />}>Sửa lớp</Button><Button variant="outline" onClick={handleRegenerateCode} leftIcon={<RefreshCw className="h-4 w-4" />}>Tạo mã mới</Button><Button variant="outline" onClick={handleArchiveToggle}>{classroom.isArchived ? "Khôi phục lớp" : "Lưu trữ lớp"}</Button></div>
        </CardContent></Card>
      </section>}

      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Chỉnh sửa lớp" footer={<><Button variant="outline" onClick={() => setIsEditOpen(false)}>Hủy</Button><Button variant="primary" onClick={() => void handleSaveClass()} isLoading={saving}>Lưu</Button></>}>
        <div className="space-y-4"><Input label="Tên lớp" value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} /><div className="grid gap-4 sm:grid-cols-2"><Input label="Môn học" value={editSubject} onChange={(event) => setEditSubject(event.target.value)} /><Input label="Khối" value={editGrade} onChange={(event) => setEditGrade(event.target.value)} /></div><Textarea label="Mô tả" rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></div>
      </Modal>

      <Modal isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setMemberEmails(""); }} title="Thêm học sinh" description="Nhập một hoặc nhiều email, mỗi địa chỉ trên một dòng hoặc cách nhau bằng dấu phẩy." footer={<><Button variant="outline" onClick={() => { setIsAddOpen(false); setMemberEmails(""); }}>Hủy</Button><Button variant="primary" onClick={() => void handleAddTypedEmails()} isLoading={saving}>Thêm học sinh</Button></>}>
        <Textarea label="Email học sinh" rows={5} placeholder="hoc.sinh@example.com" value={memberEmails} onChange={(event) => setMemberEmails(event.target.value)} />
      </Modal>
    </div>
  );
}

export default ClassDetail;
