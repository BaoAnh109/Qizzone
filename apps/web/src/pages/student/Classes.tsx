import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2, GraduationCap, KeyRound, Plus, QrCode, Search, Users } from "lucide-react";
import type { Classroom, StudentAssignmentItem } from "@qizzone/domain";
import { QrScannerPanel } from "@/components/student/QrScannerPanel";
import { extractClassroomCode } from "@/utils/classroomInvite";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";

type ClassFilterStatus = "all" | "pending" | "completed";
type JoinMethodTab = "code" | "qr";

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

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClassFilterStatus>("all");
  const [subjectFilter, setSubjectFilter] = useState("all");

  const [joinMethod, setJoinMethod] = useState<JoinMethodTab>("code");
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

  const pendingForClass = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of assignments) {
      if (item.status !== "completed") {
        counts.set(item.classroomId, (counts.get(item.classroomId) ?? 0) + 1);
      }
    }
    return (classroomId: string) => counts.get(classroomId) ?? 0;
  }, [assignments]);

  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    for (const cls of classrooms) {
      const subject = cls.subject?.trim();
      if (subject) subjects.add(subject);
    }
    return Array.from(subjects).sort((a, b) => a.localeCompare(b, "vi"));
  }, [classrooms]);

  const filteredClassrooms = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return classrooms.filter((classroom) => {
      const pendingCount = pendingForClass(classroom.id);
      if (statusFilter === "pending" && pendingCount === 0) return false;
      if (statusFilter === "completed" && pendingCount > 0) return false;
      if (subjectFilter !== "all" && (classroom.subject?.trim() || "") !== subjectFilter) return false;
      if (!query) return true;
      return (
        classroom.name.toLowerCase().includes(query) ||
        (classroom.subject || "").toLowerCase().includes(query) ||
        (classroom.teacherName || "").toLowerCase().includes(query) ||
        classroom.inviteCode.toLowerCase().includes(query)
      );
    });
  }, [classrooms, pendingForClass, searchQuery, statusFilter, subjectFilter]);

  const handleJoin = async (rawInput?: string, via: "code" | "link" = "code") => {
    const code = extractClassroomCode(rawInput ?? joinCode);
    if (!code) {
      setJoinError("Nhập mã lớp để tham gia.");
      return;
    }
    setJoinError("");
    setIsJoining(true);
    try {
      const classroom = await classroomService.joinByCode(code, via);
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
    setJoinMethod("code");
    setJoinError("");
    setIsJoinModalOpen(true);
  };

  const closeJoinModal = () => {
    setIsJoinModalOpen(false);
    setJoinError("");
  };

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setSubjectFilter("all");
  };

  const hasActiveFilters = Boolean(searchQuery.trim()) || statusFilter !== "all" || subjectFilter !== "all";

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-col gap-4 border-b theme-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">Cổng học sinh</p>
          <h1 className="page-heading mt-1">Lớp học của tôi</h1>
          <p className="page-description">Xem lớp đã tham gia, bài tập và hạn nộp.</p>
        </div>
        <Button variant="primary" onClick={openJoinModal} leftIcon={<Plus className="h-4 w-4" />}>
          Tham gia lớp
        </Button>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 theme-text-muted" aria-hidden="true" />
            <Input
              aria-label="Tìm kiếm lớp học"
              placeholder="Tìm theo tên lớp, môn học, giáo viên hoặc mã lớp..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lọc theo trạng thái bài tập">
              {(
                [
                  { id: "all", label: "Tất cả" },
                  { id: "pending", label: "Cần làm" },
                  { id: "completed", label: "Đã hoàn thành" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={statusFilter === option.id}
                  onClick={() => setStatusFilter(option.id)}
                  className={`min-h-10 rounded-lg border px-3 text-sm font-medium transition ${
                    statusFilter === option.id
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "theme-border theme-surface theme-text-secondary hover:theme-text-primary"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {availableSubjects.length > 0 && (
              <select
                aria-label="Lọc theo môn học"
                value={subjectFilter}
                onChange={(event) => setSubjectFilter(event.target.value)}
                className="min-h-10 rounded-lg border theme-border theme-surface px-3 text-sm theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <option value="all">Tất cả môn học</option>
                {availableSubjects.map((subject) => (
                  <option key={subject} value={subject}>
                    {subject}
                  </option>
                ))}
              </select>
            )}

            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                Xóa lọc
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4" aria-labelledby="my-classes-heading">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="my-classes-heading" className="text-lg font-bold theme-text-primary">Các lớp đã tham gia</h2>
            <p className="text-sm theme-text-secondary">Bài tập và thông tin lớp được cá nhân hóa cho bạn.</p>
          </div>
          <span className="text-sm theme-text-muted">
            {hasActiveFilters ? `${filteredClassrooms.length}/${classrooms.length} lớp` : `${classrooms.length} lớp`}
          </span>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Đang tải lớp học">
            {[0, 1, 2].map((item) => (
              <Card key={item} aria-hidden="true">
                <CardContent className="space-y-4 p-5">
                  <div className="h-5 w-2/3 animate-pulse rounded theme-surface-muted" />
                  <div className="h-4 w-1/2 animate-pulse rounded theme-surface-muted" />
                  <div className="h-12 animate-pulse rounded theme-surface-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : classrooms.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <GraduationCap className="mx-auto mb-3 h-9 w-9 theme-text-muted" aria-hidden="true" />
              <h3 className="font-semibold theme-text-primary">Bạn chưa tham gia lớp nào</h3>
              <p className="mt-1 text-sm theme-text-secondary">
                Nhấn nút &ldquo;Tham gia lớp&rdquo; ở góc trên để nhập mã mời hoặc quét mã QR của giáo viên.
              </p>
              <Button variant="primary" className="mt-4" onClick={openJoinModal} leftIcon={<Plus className="h-4 w-4" />}>
                Tham gia lớp
              </Button>
            </CardContent>
          </Card>
        ) : filteredClassrooms.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Search className="mx-auto mb-3 h-8 w-8 theme-text-muted" aria-hidden="true" />
              <h3 className="font-semibold theme-text-primary">Không tìm thấy lớp học phù hợp</h3>
              <p className="mt-1 text-sm theme-text-secondary">Thử đổi từ khóa tìm kiếm hoặc xóa bộ lọc đang chọn.</p>
              <Button variant="outline" className="mt-4" onClick={resetFilters}>
                Xóa bộ lọc
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredClassrooms.map((classroom) => {
              const pendingCount = pendingForClass(classroom.id);
              return (
                <Card key={classroom.id} hoverEffect className="flex h-full flex-col">
                  <CardContent className="flex flex-1 flex-col gap-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold theme-text-primary">
                          <Link
                            to={`/student/classes/${classroom.id}`}
                            className="focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {classroom.name}
                          </Link>
                        </h3>
                        <p className="mt-1 text-sm theme-text-secondary">{classroom.subject || "Chưa có môn học"}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          pendingCount > 0 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                        }`}
                      >
                        {pendingCount > 0 ? `${pendingCount} bài cần làm` : "Đã hoàn thành"}
                      </span>
                    </div>
                    <p className="text-sm theme-text-secondary">Giáo viên: {classroom.teacherName || "Giáo viên"}</p>
                    <div className="flex flex-wrap gap-4 text-sm theme-text-secondary">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-4 w-4" aria-hidden="true" />
                        {classroom.memberCount} thành viên
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                        {classroom.assignmentCount} bài tập
                      </span>
                    </div>
                    {pendingCount === 0 && (
                      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Bạn đã hoàn tất các bài tập đang có.
                      </p>
                    )}
                    <Link
                      to={`/student/classes/${classroom.id}`}
                      className="mt-auto inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Vào lớp
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        isOpen={isJoinModalOpen}
        onClose={closeJoinModal}
        title="Tham gia lớp"
        description="Chọn nhập mã lớp hoặc quét mã QR do giáo viên cung cấp."
        footer={
          joinMethod === "code" ? (
            <>
              <Button variant="outline" onClick={closeJoinModal}>Đóng</Button>
              <Button variant="primary" onClick={() => void handleJoin()} isLoading={isJoining}>
                Tham gia lớp
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={closeJoinModal}>Đóng</Button>
          )
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl border theme-border theme-surface-muted p-1" role="tablist" aria-label="Cách tham gia lớp">
            <button
              type="button"
              role="tab"
              aria-selected={joinMethod === "code"}
              onClick={() => { setJoinMethod("code"); setJoinError(""); }}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${
                joinMethod === "code"
                  ? "theme-surface theme-text-primary shadow-xs"
                  : "theme-text-secondary hover:theme-text-primary"
              }`}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Nhập mã
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={joinMethod === "qr"}
              onClick={() => { setJoinMethod("qr"); setJoinError(""); }}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${
                joinMethod === "qr"
                  ? "theme-surface theme-text-primary shadow-xs"
                  : "theme-text-secondary hover:theme-text-primary"
              }`}
            >
              <QrCode className="h-4 w-4" aria-hidden="true" />
              Quét mã QR
            </button>
          </div>

          {joinMethod === "code" ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleJoin();
              }}
            >
              <Input
                label="Mã lớp hoặc đường dẫn mời"
                placeholder="VD: CLS123 hoặc dán link lớp"
                value={joinCode}
                onChange={(event) => {
                  setJoinCode(event.target.value);
                  setJoinError("");
                }}
              />
              <p className="text-xs theme-text-muted">
                Bạn cũng có thể bấm trực tiếp vào link mời do giáo viên gửi để mở trang xác nhận và tham gia lớp.
              </p>
            </form>
          ) : (
            <QrScannerPanel
              disabled={isJoining}
              onDetected={(scannedCode) => {
                const isLink = /\/class\/join\//i.test(scannedCode);
                void handleJoin(scannedCode, isLink ? "link" : "code");
              }}
            />
          )}

          {joinError && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">
              {joinError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default Classes;
