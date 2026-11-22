import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  Users,
} from "lucide-react";
import type {
  ClassroomAssignment,
  ClassroomDetail,
  ClassroomMember,
  LatePolicy,
  TeacherQuizTrackingResult,
} from "@qizzone/domain";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";
import { useQuizStore } from "@/store/quizStore";
import { parseRosterImportFile, type RosterImportParseResult } from "@/utils/excelRosterImport";

type DetailTab = "students" | "assignments" | "gradebook" | "settings";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Chưa đặt";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
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

function initials(name: string | null | undefined, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/\s+/);
  return parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : source.slice(0, 2).toUpperCase();
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
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [confirmState, setConfirmState] = useState<
    | { type: "regenerate_code" }
    | { type: "archive_toggle"; nextArchived: boolean }
    | { type: "remove_member"; member: ClassroomMember }
    | null
  >(null);
  const quizzes = useQuizStore((state) => state.quizzes);
  const loadQuizzes = useQuizStore((state) => state.load);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [assignQuizId, setAssignQuizId] = useState("");
  const [assignDueAt, setAssignDueAt] = useState("");
  const [assignHardCloseAt, setAssignHardCloseAt] = useState("");
  const [assignLatePolicy, setAssignLatePolicy] = useState<LatePolicy>("block_after_due");
  const [assignError, setAssignError] = useState("");
  const [gradebookData, setGradebookData] = useState<Record<string, TeacherQuizTrackingResult>>({});
  const [gradebookLoading, setGradebookLoading] = useState(false);
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
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? `Không có quyền xem lớp học hoặc không tìm thấy lớp. ${error.message}`
              : "Không có quyền xem lớp học hoặc không tìm thấy lớp."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [classroomId]);

  const refreshDetail = async () => {
    if (!classroomId) return;
    setDetail(await classroomService.getClassroomDetail(classroomId));
  };

  const openEdit = () => {
    if (!detail) return;
    setEditName(detail.classroom.name);
    setEditSubject(detail.classroom.subject);
    setEditGrade(detail.classroom.gradeLevel);
    setEditDescription(detail.classroom.description);
    setIsEditOpen(true);
  };

  const handleSaveClass = async () => {
    if (!classroomId) return;
    if (!editName.trim()) {
      toast.error("Tên lớp không được để trống.");
      return;
    }
    setSaving(true);
    try {
      const classroom = await classroomService.updateClassroom(classroomId, {
        name: editName.trim(),
        subject: editSubject.trim(),
        gradeLevel: editGrade.trim(),
        description: editDescription.trim(),
      });
      setDetail((current) => (current ? { ...current, classroom } : current));
      setIsEditOpen(false);
      toast.success("Đã lưu thông tin lớp học.");
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
      setDetail((current) => (current ? { ...current, classroom } : current));
      toast.success(inviteEnabled ? "Đã bật mã mời tham gia lớp." : "Đã tắt mã mời tham gia lớp.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật cài đặt mã mời.");
    }
  };

  const handleRegenerateCode = () => {
    if (!detail || !classroomId) return;
    setConfirmState({ type: "regenerate_code" });
  };

  const executeRegenerateCode = async () => {
    if (!detail || !classroomId) return;
    try {
      const inviteCode = await classroomService.regenerateInviteCode(classroomId);
      setDetail((current) => (current ? { ...current, classroom: { ...current.classroom, inviteCode } } : current));
      toast.success("Đã tạo mã mời mới.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể đổi mã mời.");
    }
  };

  const handleArchiveToggle = () => {
    if (!detail || !classroomId) return;
    setConfirmState({ type: "archive_toggle", nextArchived: !detail.classroom.isArchived });
  };

  const executeArchiveToggle = async (nextArchived: boolean) => {
    if (!detail || !classroomId) return;
    try {
      const classroom = await classroomService.updateClassroom(classroomId, { isArchived: nextArchived });
      setDetail((current) => (current ? { ...current, classroom } : current));
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
      toast.error(error instanceof Error ? error.message : "Không thể thêm học sinh.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAddTypedEmails = async () => {
    const emails = memberEmails.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
    if (await handleAddMembers(emails, "teacher_email")) {
      setMemberEmails("");
      setIsAddOpen(false);
    }
  };

  const handleFileChange = async (file?: File) => {
    if (!file) return;
    setImportError("");
    try {
      const parsed = await parseRosterImportFile(file);
      if (parsed.emails.length === 0) {
        setImportError("Không tìm thấy email hợp lệ trong tệp đã chọn.");
        setImportPreview(null);
      } else {
        setImportPreview(parsed);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Không thể đọc tệp danh sách học sinh.");
      setImportPreview(null);
    }
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    if (await handleAddMembers(importPreview.emails, "excel_import")) {
      setImportPreview(null);
      setImportError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveMember = (member: ClassroomMember) => {
    if (!classroomId) return;
    setConfirmState({ type: "remove_member", member });
  };

  const executeRemoveMember = async (member: ClassroomMember) => {
    if (!classroomId) return;
    try {
      await classroomService.removeMember(classroomId, member.id);
      await refreshDetail();
      toast.success("Đã xóa học sinh khỏi lớp.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể xóa học sinh khỏi lớp.");
    }
  };

  const publishedQuizzes = useMemo(
    () => quizzes.filter((q) => q.status === "published"),
    [quizzes]
  );

  const openAssignModal = () => {
    setAssignError("");
    setAssignQuizId(publishedQuizzes[0]?.id ?? "");
    setAssignDueAt("");
    setAssignHardCloseAt("");
    setAssignLatePolicy("block_after_due");
    setIsAssignOpen(true);
    if (quizzes.length === 0) {
      void loadQuizzes().catch(() => undefined);
    }
  };

  const handleAssignQuizToClass = async () => {
    if (!classroomId) return;
    if (!assignQuizId) {
      setAssignError("Vui lòng chọn đề thi cần giao.");
      return;
    }
    if (!assignDueAt) {
      setAssignError("Vui lòng chọn hạn nộp.");
      return;
    }
    const dueDate = new Date(assignDueAt);
    const hardCloseDate = assignHardCloseAt ? new Date(assignHardCloseAt) : null;
    if (hardCloseDate && hardCloseDate.getTime() < dueDate.getTime()) {
      setAssignError("Hạn cuối phải sau hoặc bằng hạn nộp.");
      return;
    }
    setSaving(true);
    setAssignError("");
    try {
      await classroomService.assignQuizToClassrooms({
        quizId: assignQuizId,
        assignments: [
          {
            classroomId,
            instructions: "",
            dueAt: dueDate.toISOString(),
            latePolicy: assignLatePolicy,
            hardCloseAt: hardCloseDate ? hardCloseDate.toISOString() : null,
          },
        ],
      });
      await refreshDetail();
      setIsAssignOpen(false);
      toast.success("Đã giao đề thi cho lớp.");
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : "Không thể giao đề thi cho lớp.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (tab !== "gradebook" || !classroomId || !detail?.assignments.length) return undefined;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (!cancelled) setGradebookLoading(true);
      try {
        const uniqueQuizIds = Array.from(new Set(detail.assignments.map((item) => item.quizId)));
        const entries = await Promise.all(
          uniqueQuizIds.map(async (quizId) => {
            const res = await classroomService.listTeacherQuizTracking(quizId, classroomId);
            return [quizId, res] as const;
          })
        );
        if (!cancelled) {
          setGradebookData(Object.fromEntries(entries));
        }
      } catch {
        if (!cancelled) toast.error("Không thể tải dữ liệu sổ điểm.");
      } finally {
        if (!cancelled) setGradebookLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [classroomId, detail?.assignments, tab, toast]);

  const handleExportGradebookCsv = () => {
    if (!detail) return;
    const { classroom: cls, members: mems, assignments: assigns } = detail;
    const active = visibleMembers(mems);
    const headers = [
      "Học sinh",
      "Email",
      "Tiến độ",
      "Điểm TB",
      ...assigns.map((a) => a.title || a.quizTitle || "Bài tập"),
    ];
    const escapeCsv = (value: string | number) => {
      const str = String(value);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : `"${str}"`;
    };
    const rows = active.map((member) => {
      let submitted = 0;
      const scores: number[] = [];
      const cells = assigns.map((assignment) => {
        const tracking = gradebookData[assignment.quizId];
        const row = tracking?.rows.find(
          (s) => s.studentUid === member.studentUid || s.invitedEmail.toLowerCase() === member.invitedEmail.toLowerCase()
        );
        if (!row || row.status === "not_submitted") return "Chưa nộp";
        submitted += 1;
        if (typeof row.score === "number") {
          scores.push(row.score);
          return `${row.score.toFixed(2)}${row.status === "submitted_late" ? " (Muộn)" : ""}`;
        }
        return row.status === "submitted_late" ? "Nộp muộn" : "Đã nộp";
      });
      const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "—";
      return [member.memberName || member.invitedEmail, member.invitedEmail, `${submitted}/${assigns.length}`, avg, ...cells];
    });
    const csv = "\uFEFF" + [headers.map(escapeCsv).join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SoDiem_${cls.inviteCode}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất sổ điểm lớp học.");
  };

  if (loading) return <Card><CardContent className="p-6 text-sm theme-text-secondary">Đang tải lớp học…</CardContent></Card>;
  if (loadError || !detail) {
    return (
      <div className="space-y-4">
        <Link to="/teacher/classes" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Quay lại lớp học
        </Link>
        <Card><CardContent className="p-6 text-sm theme-text-secondary">{loadError || "Không tìm thấy lớp học."}</CardContent></Card>
      </div>
    );
  }

  const { classroom, members, assignments } = detail;
  const activeMembers = visibleMembers(members);
  const tabs: Array<{ id: DetailTab; label: string; icon: typeof Users }> = [
    { id: "students", label: "Học sinh", icon: Users },
    { id: "assignments", label: "Bài tập", icon: BookOpen },
    { id: "gradebook", label: "Sổ điểm", icon: Award },
    { id: "settings", label: "Cài đặt", icon: Settings },
  ];

  return (
    <div className="space-y-6 pb-16">
      <Link to="/teacher/classes" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Lớp học
      </Link>

      <header className="flex flex-col gap-4 border-b theme-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-heading">{classroom.name}</h1>
            {classroom.isArchived && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Đã lưu trữ</span>}
          </div>
          <p className="mt-1 text-sm theme-text-secondary">
            {[classroom.subject, classroom.gradeLevel && `Khối ${classroom.gradeLevel}`].filter(Boolean).join(" · ") || "Lớp học của bạn"}
          </p>
        </div>
        <Button variant="outline" onClick={openEdit} leftIcon={<Pencil className="h-4 w-4" />}>Chỉnh sửa lớp</Button>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide theme-text-muted">Mã mời vào lớp</p>
              <p className="mt-1 font-mono text-xl font-bold tracking-wider theme-text-primary">{classroom.inviteCode}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const inviteLink = `${window.location.origin}/class/join/${classroom.inviteCode}`;
                void navigator.clipboard.writeText(inviteLink).then(
                  () => toast.success("Đã sao chép đường dẫn mời vào lớp."),
                  () => toast.error("Không thể sao chép đường dẫn.")
                );
              }}
              leftIcon={<Link2 className="h-4 w-4" />}
            >
              Sao chép link
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const inviteLink = `${window.location.origin}/class/join/${classroom.inviteCode}`;
                void QRCode.toDataURL(inviteLink, { width: 320, margin: 2 })
                  .then((url) => {
                    setQrDataUrl(url);
                    setIsQrOpen(true);
                  })
                  .catch(() => toast.error("Không thể tạo mã QR."));
              }}
              leftIcon={<QrCode className="h-4 w-4" />}
            >
              Mã QR
            </Button>
            <div className="flex min-h-11 items-center gap-2 rounded-lg border theme-border px-3">
              <span className="text-xs font-medium theme-text-secondary">Cho phép tham gia</span>
              <button
                type="button"
                role="switch"
                aria-label="Cho phép tham gia bằng mã mời"
                aria-checked={classroom.inviteEnabled}
                onClick={() => void handleToggleInvite()}
                className="relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition ${classroom.inviteEnabled ? "bg-emerald-600" : "bg-neutral-400"}`}>
                  <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${classroom.inviteEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </span>
              </button>
            </div>
            <Button variant="outline" onClick={handleRegenerateCode} leftIcon={<RefreshCw className="h-4 w-4" />}>Đổi mã mời</Button>
            <Button variant="outline" onClick={handleArchiveToggle}>{classroom.isArchived ? "Khôi phục lớp" : "Lưu trữ lớp"}</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-1 overflow-x-auto border-b theme-border" role="tablist" aria-label="Nội dung lớp học">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition ${
              tab === id ? "border-blue-700 text-blue-800" : "border-transparent theme-text-secondary hover:theme-text-primary"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
            {id === "students" ? ` (${activeMembers.length})` : id === "assignments" ? ` (${assignments.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "students" && (
        <section role="tabpanel" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold theme-text-primary">Danh sách học sinh</h2>
              <p className="text-sm theme-text-secondary">Học sinh chưa đăng ký sẽ được mời bằng email.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setIsAddOpen(true)} leftIcon={<Users className="h-4 w-4" />}>Thêm học sinh</Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={saving} leftIcon={<FileSpreadsheet className="h-4 w-4" />}>Nhập danh sách Excel</Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                aria-label="Tệp danh sách học sinh"
                disabled={saving}
                onChange={(event) => void handleFileChange(event.target.files?.[0])}
              />
            </div>
          </div>

          {importError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{importError}</p>}
          {importPreview && (
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="font-semibold theme-text-primary">Xem trước danh sách nhập</p>
                  <p className="theme-text-secondary">
                    {importPreview.emails.length} email hợp lệ
                    {importPreview.duplicateCount > 0 ? `, ${importPreview.duplicateCount} email trùng` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setImportPreview(null)}>Hủy</Button>
                  <Button variant="primary" onClick={() => void handleImportConfirm()} isLoading={saving}>Xác nhận nhập</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeMembers.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm theme-text-secondary">Lớp chưa có học sinh. Thêm email học sinh hoặc chia sẻ mã mời.</CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border theme-border theme-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b theme-border theme-surface-muted text-xs uppercase theme-text-secondary">
                  <tr>
                    <th className="px-4 py-3">Học sinh</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3">Nguồn tham gia</th>
                    <th className="px-4 py-3">Ngày tham gia</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y theme-border">
                  {activeMembers.map((member) => (
                    <tr key={member.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">
                            {initials(member.memberName, member.invitedEmail)}
                          </span>
                          <div>
                            <div className="font-medium theme-text-primary">{member.memberName || member.invitedEmail}</div>
                            {member.memberName && <div className="text-xs theme-text-muted">{member.invitedEmail}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${member.status === "active" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                          {member.status === "active" ? "Đang học" : "Đã mời"}
                        </span>
                      </td>
                      <td className="px-4 py-3 theme-text-secondary">
                        {member.joinedVia === "teacher_email"
                          ? "Giáo viên thêm"
                          : member.joinedVia === "excel_import"
                            ? "Nhập Excel"
                            : member.joinedVia === "link"
                              ? "Đường dẫn"
                              : "Mã mời"}
                      </td>
                      <td className="px-4 py-3 theme-text-secondary">{formatDate(member.joinedAt || member.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => handleRemoveMember(member)}>Xóa</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "assignments" && (
        <section role="tabpanel" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold theme-text-primary">Bài tập đã giao</h2>
              <p className="text-sm theme-text-secondary">Theo dõi hạn nộp và chính sách làm bài của lớp.</p>
            </div>
            <Button variant="primary" onClick={openAssignModal} leftIcon={<Plus className="h-4 w-4" />}>Giao đề thi</Button>
          </div>
          {assignments.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm theme-text-secondary">Lớp chưa có bài tập được giao.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {assignments.map((assignment) => (
                <Card key={assignment.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-semibold theme-text-primary">{assignment.title || assignment.quizTitle || "Bài tập"}</h3>
                      <p className="mt-1 text-sm theme-text-secondary">{assignment.instructions || assignment.quizTitle || ""}</p>
                      <p className="mt-1 text-xs theme-text-muted">Đã giao: {formatDate(assignment.createdAt)}</p>
                      <Link
                        className="mt-3 inline-flex min-h-11 items-center font-semibold text-blue-700 hover:text-blue-900"
                        to={`/teacher/quiz/${assignment.quizId}/results?classroomId=${encodeURIComponent(classroom.id)}`}
                      >
                        Xem kết quả
                      </Link>
                    </div>
                    <div className="shrink-0 space-y-1 text-sm theme-text-secondary">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          assignmentStatus(assignment) === "Đã đóng"
                            ? "bg-neutral-100 text-neutral-800"
                            : assignmentStatus(assignment) === "Sắp diễn ra"
                              ? "bg-blue-100 text-blue-900"
                              : "bg-emerald-100 text-emerald-900"
                        }`}
                      >
                        {assignmentStatus(assignment)}
                      </span>
                      <div>Hạn nộp: {formatDate(assignment.dueAt)}</div>
                      <div>Chính sách: {assignment.latePolicy === "allow_late" ? "Cho phép nộp muộn" : "Chặn sau hạn"}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "gradebook" && (
        <section role="tabpanel" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold theme-text-primary">Sổ điểm lớp học</h2>
              <p className="text-sm theme-text-secondary">Bảng ma trận điểm số và tiến độ hoàn thành tất cả bài tập trong lớp.</p>
            </div>
            {assignments.length > 0 && activeMembers.length > 0 && (
              <Button variant="outline" onClick={handleExportGradebookCsv} leftIcon={<Download className="h-4 w-4" />}>
                Xuất Sổ điểm CSV
              </Button>
            )}
          </div>
          {assignments.length === 0 || activeMembers.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm theme-text-secondary">Cần có học sinh và bài tập đã giao để hiển thị sổ điểm.</CardContent></Card>
          ) : gradebookLoading ? (
            <Card><CardContent className="p-8 text-center text-sm theme-text-secondary">Đang tải dữ liệu sổ điểm…</CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border theme-border theme-surface">
              <table className="w-full text-left text-xs">
                <thead className="border-b theme-border theme-surface-muted theme-text-secondary">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Học sinh</th>
                    <th className="px-3 py-3 text-center font-semibold">Tiến độ</th>
                    <th className="px-3 py-3 text-center font-semibold">Điểm TB</th>
                    {assignments.map((assignment) => (
                      <th key={assignment.id} className="min-w-[130px] px-3 py-3 font-semibold">
                        <span className="line-clamp-1">{assignment.title || assignment.quizTitle || "Bài tập"}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y theme-border">
                  {activeMembers.map((member) => {
                    let submittedCount = 0;
                    const scores: number[] = [];
                    const cells = assignments.map((assignment) => {
                      const tracking = gradebookData[assignment.quizId];
                      const row = tracking?.rows.find(
                        (s) => s.studentUid === member.studentUid || s.invitedEmail.toLowerCase() === member.invitedEmail.toLowerCase()
                      );
                      if (!row || row.status === "not_submitted") {
                        return { key: assignment.id, label: "Chưa nộp", tone: "theme-text-muted" };
                      }
                      submittedCount += 1;
                      if (typeof row.score === "number") {
                        scores.push(row.score);
                        return {
                          key: assignment.id,
                          label: `${row.score.toFixed(2)}${row.status === "submitted_late" ? " (Muộn)" : ""}`,
                          tone: row.status === "submitted_late" ? "font-semibold text-amber-700" : "font-semibold text-emerald-700",
                        };
                      }
                      return {
                        key: assignment.id,
                        label: row.status === "submitted_late" ? "Nộp muộn" : "Đã nộp",
                        tone: "font-medium text-blue-700",
                      };
                    });
                    const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "—";
                    return (
                      <tr key={member.id} className="theme-hover-surface">
                        <td className="px-4 py-3">
                          <div className="font-medium theme-text-primary">{member.memberName || member.invitedEmail}</div>
                          {member.memberName && <div className="text-[11px] theme-text-muted">{member.invitedEmail}</div>}
                        </td>
                        <td className="px-3 py-3 text-center font-mono">{submittedCount}/{assignments.length}</td>
                        <td className="px-3 py-3 text-center font-mono font-bold text-blue-700">{avg}</td>
                        {cells.map((cell) => (
                          <td key={cell.key} className={`px-3 py-3 ${cell.tone}`}>{cell.label}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "settings" && (
        <section role="tabpanel" className="space-y-4">
          <Card>
            <CardContent className="space-y-5 p-5">
              <div>
                <h2 className="text-lg font-semibold theme-text-primary">Cài đặt lớp</h2>
                <p className="text-sm theme-text-secondary">Quản lý thông tin và quyền tham gia lớp.</p>
              </div>
              <div className="rounded-xl border theme-border p-4">
                <p className="font-semibold theme-text-primary">Mã mời {classroom.inviteEnabled ? "đang bật" : "đang tắt"}</p>
                <p className="text-sm theme-text-secondary">
                  {classroom.inviteEnabled ? "Học sinh có thể tham gia bằng mã mời." : "Học sinh mới chưa thể tham gia bằng mã mời."} Thay đổi nhanh bằng công tắc ở đầu trang.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={openEdit} leftIcon={<Pencil className="h-4 w-4" />}>Sửa lớp</Button>
                <Button variant="outline" onClick={handleRegenerateCode} leftIcon={<RefreshCw className="h-4 w-4" />}>Tạo mã mới</Button>
                <Button variant="outline" onClick={handleArchiveToggle}>{classroom.isArchived ? "Khôi phục lớp" : "Lưu trữ lớp"}</Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <Modal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Chỉnh sửa lớp"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Hủy</Button>
            <Button variant="primary" onClick={() => void handleSaveClass()} isLoading={saving}>Lưu</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Tên lớp" value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Môn học" value={editSubject} onChange={(event) => setEditSubject(event.target.value)} />
            <Input label="Khối" value={editGrade} onChange={(event) => setEditGrade(event.target.value)} />
          </div>
          <Textarea label="Mô tả" rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
        </div>
      </Modal>

      <Modal
        isOpen={isAddOpen}
        onClose={() => { setIsAddOpen(false); setMemberEmails(""); }}
        title="Thêm học sinh"
        description="Nhập một hoặc nhiều email, mỗi địa chỉ trên một dòng hoặc cách nhau bằng dấu phẩy."
        footer={
          <>
            <Button variant="outline" onClick={() => { setIsAddOpen(false); setMemberEmails(""); }}>Hủy</Button>
            <Button variant="primary" onClick={() => void handleAddTypedEmails()} isLoading={saving}>Thêm học sinh</Button>
          </>
        }
      >
        <Textarea label="Email học sinh" rows={5} placeholder="hoc.sinh@example.com" value={memberEmails} onChange={(event) => setMemberEmails(event.target.value)} />
      </Modal>

      <Modal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        title={`Mã QR tham gia lớp ${classroom.name}`}
        description="Học sinh có thể quét mã QR này hoặc mở đường dẫn mời để tham gia lớp."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                const inviteLink = `${window.location.origin}/class/join/${classroom.inviteCode}`;
                void navigator.clipboard.writeText(inviteLink).then(
                  () => toast.success("Đã sao chép đường dẫn mời vào lớp."),
                  () => toast.error("Không thể sao chép đường dẫn.")
                );
              }}
              leftIcon={<Copy className="h-4 w-4" />}
            >
              Sao chép link
            </Button>
            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download={`qr-${classroom.inviteCode}.png`}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Tải mã QR
              </a>
            )}
          </>
        }
      >
        <div className="flex flex-col items-center gap-4 text-center">
          {qrDataUrl && (
            <div className="rounded-2xl border theme-border bg-white p-3">
              <img src={qrDataUrl} alt={`Mã QR lớp ${classroom.name}`} className="h-56 w-56" />
            </div>
          )}
          <div className="w-full rounded-xl border theme-border theme-surface-muted p-3 text-sm">
            <p className="font-mono text-base font-bold text-blue-800">{classroom.inviteCode}</p>
            <p className="mt-1 break-all text-xs theme-text-secondary">
              {`${window.location.origin}/class/join/${classroom.inviteCode}`}
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isAssignOpen}
        onClose={() => setIsAssignOpen(false)}
        title={`Giao đề thi cho lớp ${classroom.name}`}
        description="Chọn đề thi đã xuất bản và thiết lập hạn nộp cho học sinh trong lớp."
        footer={
          <>
            <Button variant="outline" onClick={() => setIsAssignOpen(false)}>Hủy</Button>
            <Button variant="primary" onClick={() => void handleAssignQuizToClass()} isLoading={saving} disabled={publishedQuizzes.length === 0}>
              Giao bài
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium theme-text-secondary">
            <span>Chọn đề thi</span>
            {publishedQuizzes.length === 0 ? (
              <p className="rounded-lg theme-surface-muted p-3 text-sm theme-text-secondary">
                Bạn chưa có đề thi nào ở trạng thái Đang mở (published).
              </p>
            ) : (
              <select
                value={assignQuizId}
                onChange={(event) => setAssignQuizId(event.target.value)}
                className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                {publishedQuizzes.map((q) => (
                  <option key={q.id} value={q.id}>{q.title} ({q.code})</option>
                ))}
              </select>
            )}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Hạn nộp" type="datetime-local" value={assignDueAt} onChange={(event) => { setAssignDueAt(event.target.value); setAssignError(""); }} />
            <Input label="Đóng hẳn (tùy chọn)" type="datetime-local" value={assignHardCloseAt} onChange={(event) => { setAssignHardCloseAt(event.target.value); setAssignError(""); }} />
          </div>
          <label className="block space-y-1.5 text-sm font-medium theme-text-secondary">
            <span>Chính sách nộp muộn</span>
            <select
              value={assignLatePolicy}
              onChange={(event) => setAssignLatePolicy(event.target.value as LatePolicy)}
              className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="block_after_due">Chặn sau hạn nộp</option>
              <option value="allow_late">Cho phép nộp muộn</option>
            </select>
          </label>
          {assignError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{assignError}</p>}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return;
          const pending = confirmState;
          setConfirmState(null);
          if (pending.type === "regenerate_code") void executeRegenerateCode();
          else if (pending.type === "archive_toggle") void executeArchiveToggle(pending.nextArchived);
          else void executeRemoveMember(pending.member);
        }}
        title={
          confirmState?.type === "regenerate_code"
            ? "Đổi mã mời lớp học"
            : confirmState?.type === "archive_toggle"
              ? confirmState.nextArchived ? "Lưu trữ lớp học" : "Khôi phục lớp học"
              : "Xóa học sinh khỏi lớp"
        }
        description={
          confirmState?.type === "regenerate_code"
            ? "Đổi mã mời của lớp? Mã cũ sẽ không còn sử dụng được."
            : confirmState?.type === "archive_toggle"
              ? confirmState.nextArchived
                ? "Lưu trữ lớp học này? Học sinh sẽ không thể tham gia lớp bằng mã mời."
                : "Khôi phục lớp học này?"
              : confirmState?.type === "remove_member"
                ? `Xóa ${confirmState.member.invitedEmail} khỏi lớp?`
                : ""
        }
        confirmText={
          confirmState?.type === "remove_member"
            ? "Xóa"
            : confirmState?.type === "regenerate_code"
              ? "Đổi mã"
              : confirmState?.type === "archive_toggle" && !confirmState.nextArchived
                ? "Khôi phục"
                : "Xác nhận"
        }
        variant={confirmState?.type === "remove_member" ? "destructive" : "primary"}
      />
    </div>
  );
}

export default ClassDetail;
