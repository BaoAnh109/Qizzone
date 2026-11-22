import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { BookOpen, GraduationCap, Lock, RefreshCw, Search, Unlock, Users } from "lucide-react";
import {
  formatVietnamDateTime,
  type AdminAccountDetail,
  type AdminAccountSummary,
  type ApprovalStatus,
  type UserRole,
} from "@qizzone/domain";
import { useNavigate } from "react-router-dom";
import { adminService } from "@/services/adminService";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

type AccountTab = "teacher" | "student";

const ROLE_LABELS: Record<UserRole, string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
  admin: "Quản trị viên",
};

const ROLE_OPTIONS: UserRole[] = ["student", "teacher", "admin"];

function effectiveRole(account: AdminAccountSummary): UserRole {
  return account.activeRole ?? account.role;
}

function approvalLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Đã duyệt";
    case "pending":
      return "Chờ duyệt";
    case "rejected":
      return "Từ chối";
    case "none":
      return "Chưa gửi yêu cầu";
    default:
      return "Chưa xác định";
  }
}

function formatDate(value: string | null | undefined): string {
  return value ? formatVietnamDateTime(value) : "—";
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border theme-border theme-surface-muted p-4">
      <p className="text-xs font-medium theme-text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold theme-text-primary">{value}</p>
    </div>
  );
}

export function AccountManagement() {
  const navigate = useNavigate();
  const toast = useToast();
  const toastRef = useRef(toast);
  const detailRequestId = useRef(0);
  const [activeTab, setActiveTab] = useState<AccountTab>("teacher");
  const [searchTerm, setSearchTerm] = useState("");
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<AdminAccountSummary | null>(null);
  const [accountDetail, setAccountDetail] = useState<AdminAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<UserRole>("student");
  const [confirmAction, setConfirmAction] = useState<
    | { type: "block"; account: AdminAccountSummary }
    | { type: "role"; account: AdminAccountSummary; fromRole: UserRole; toRole: UserRole }
    | null
  >(null);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const loadAccounts = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    setLoadError(null);
    try {
      const data = await adminService.listAccountSummaries();
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      const message = "Không thể tải danh sách tài khoản. Vui lòng thử lại.";
      setLoadError(message);
      toastRef.current.error(message);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void adminService
      .listAccountSummaries()
      .then((data) => {
        if (cancelled) return;
        setAccounts(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch(() => {
        if (cancelled) return;
        const message = "Không thể tải danh sách tài khoản. Vui lòng thử lại.";
        setLoadError(message);
        toastRef.current.error(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const teacherCount = useMemo(
    () => accounts.filter((account) => effectiveRole(account) === "teacher").length,
    [accounts],
  );
  const studentCount = useMemo(
    () => accounts.filter((account) => effectiveRole(account) === "student").length,
    [accounts],
  );
  const filteredAccounts = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase();
    return accounts.filter((account) => {
      if (effectiveRole(account) !== activeTab) return false;
      return !term || (account.fullName + " " + account.email).toLocaleLowerCase().includes(term);
    });
  }, [accounts, activeTab, searchTerm]);

  const openAccountDetail = async (account: AdminAccountSummary) => {
    const requestId = ++detailRequestId.current;
    const uid = account.firebaseUid || account.id;
    setSelectedAccount(account);
    setAccountDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setRoleDraft(effectiveRole(account));
    try {
      const detail = await adminService.getAccountDetail(uid);
      if (detailRequestId.current !== requestId) return;
      setAccountDetail(detail);
      setSelectedAccount(detail.profile);
      setRoleDraft(effectiveRole(detail.profile));
    } catch {
      if (detailRequestId.current === requestId) {
        setDetailError("Không thể tải chi tiết tài khoản. Vui lòng thử lại.");
      }
    } finally {
      if (detailRequestId.current === requestId) setDetailLoading(false);
    }
  };

  const closeAccountDetail = () => {
    detailRequestId.current += 1;
    setSelectedAccount(null);
    setAccountDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const refreshSelectedDetail = async (uid: string) => {
    const requestId = detailRequestId.current;
    try {
      const detail = await adminService.getAccountDetail(uid);
      if (detailRequestId.current !== requestId) return;
      setAccountDetail(detail);
      setSelectedAccount(detail.profile);
      setRoleDraft(effectiveRole(detail.profile));
    } catch {
      if (detailRequestId.current === requestId) {
        setDetailError("Đã lưu thay đổi nhưng không thể tải lại chi tiết tài khoản.");
      }
    }
  };

  const handleToggleBlock = (
    account: AdminAccountSummary,
    event?: MouseEvent<HTMLButtonElement>,
  ) => {
    event?.stopPropagation();
    setConfirmAction({ type: "block", account });
  };

  const executeToggleBlock = async (account: AdminAccountSummary) => {
    const nextBlocked = !account.isBlocked;

    const uid = account.firebaseUid || account.id;
    const nextApprovalStatus: ApprovalStatus = nextBlocked ? "rejected" : "approved";
    setProcessingId(account.id);
    try {
      await adminService.toggleBlockUser(uid, nextBlocked, effectiveRole(account));
      const patchAccount = (item: AdminAccountSummary) =>
        item.id === account.id || item.firebaseUid === uid
          ? {
              ...item,
              isBlocked: nextBlocked,
              approvalStatus: nextApprovalStatus,
            }
          : item;
      setAccounts((previous) => previous.map(patchAccount));
      setSelectedAccount((previous) =>
        previous && (previous.id === account.id || previous.firebaseUid === uid)
          ? patchAccount(previous)
          : previous,
      );
      setAccountDetail((previous) =>
        previous && (previous.profile.id === account.id || previous.profile.firebaseUid === uid)
          ? { ...previous, profile: patchAccount(previous.profile) }
          : previous,
      );
      await loadAccounts();
      if (selectedAccount && (selectedAccount.id === account.id || selectedAccount.firebaseUid === uid)) {
        await refreshSelectedDetail(uid);
      }
      toastRef.current.success(
        nextBlocked
          ? "Đã khóa tài khoản \"" + account.fullName + "\"."
          : "Đã mở khóa tài khoản \"" + account.fullName + "\".",
      );
    } catch {
      toastRef.current.error("Không thể thay đổi trạng thái tài khoản. Vui lòng thử lại.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReviewTeacher = async (decision: "approve" | "reject") => {
    if (!selectedAccount) return;
    const uid = selectedAccount.firebaseUid || selectedAccount.id;
    setProcessingId(selectedAccount.id);
    try {
      await adminService.reviewTeacherAccount(uid, decision);
      await loadAccounts();
      await refreshSelectedDetail(uid);
      toastRef.current.success(
        decision === "approve"
          ? "Đã phê duyệt yêu cầu của " + selectedAccount.fullName + "."
          : "Đã từ chối yêu cầu của " + selectedAccount.fullName + ".",
      );
    } catch {
      toastRef.current.error("Không thể cập nhật yêu cầu giáo viên. Vui lòng thử lại.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleSaveRole = () => {
    if (!selectedAccount) return;
    const currentRole = effectiveRole(accountDetail?.profile ?? selectedAccount);
    if (roleDraft === currentRole) return;
    setConfirmAction({
      type: "role",
      account: selectedAccount,
      fromRole: currentRole,
      toRole: roleDraft,
    });
  };

  const executeSaveRole = async (account: AdminAccountSummary, nextRole: UserRole) => {
    const uid = account.firebaseUid || account.id;
    setProcessingId(account.id);
    try {
      await adminService.changeUserRole(uid, nextRole);
      await loadAccounts();
      await refreshSelectedDetail(uid);
      toastRef.current.success("Đã cập nhật vai trò của " + account.fullName + ".");
    } catch {
      toastRef.current.error("Không thể cập nhật vai trò. Vui lòng thử lại.");
    } finally {
      setProcessingId(null);
    }
  };

  const accountForModal = accountDetail?.profile ?? selectedAccount;
  const canReviewTeacher =
    accountForModal?.teacherRequestStatus === "pending" ||
    (accountForModal?.role === "teacher" && accountForModal.approvalStatus === "pending");

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    account: AdminAccountSummary,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openAccountDetail(account);
  };

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col justify-between gap-4 border-b theme-border pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full theme-surface-muted px-3 py-1 text-xs font-semibold theme-text-secondary">
            <Users className="h-4 w-4" aria-hidden="true" />
            Quản trị người dùng
          </div>
          <h1 className="page-heading">Quản lý tài khoản</h1>
          <p className="page-description">
            Xem thông tin, trạng thái và hoạt động của giáo viên và học sinh.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => void loadAccounts(true)}
          disabled={isLoading}
          isLoading={isLoading}
          leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
        >
          Làm mới
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex flex-wrap rounded-xl border theme-border theme-surface-muted p-1"
          role="tablist"
          aria-label="Lọc tài khoản theo vai trò"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "teacher"}
            onClick={() => setActiveTab("teacher")}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors cursor-pointer",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
              activeTab === "teacher"
                ? "theme-surface theme-text-primary shadow-xs"
                : "theme-text-secondary theme-hover-surface",
            )}
          >
            <GraduationCap className="h-4 w-4" aria-hidden="true" />
            <span>Giáo viên</span>
            <span className="rounded-full px-2 py-0.5 text-xs theme-surface-inset theme-text-secondary">
              {teacherCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "student"}
            onClick={() => setActiveTab("student")}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors cursor-pointer",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
              activeTab === "student"
                ? "theme-surface theme-text-primary shadow-xs"
                : "theme-text-secondary theme-hover-surface",
            )}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            <span>Học sinh</span>
            <span className="rounded-full px-2 py-0.5 text-xs theme-surface-inset theme-text-secondary">
              {studentCount}
            </span>
          </button>
        </div>

        <div className="w-full sm:max-w-sm">
          <Input
            aria-label="Tìm kiếm tài khoản"
            placeholder="Tìm theo tên hoặc email..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
          />
        </div>
      </div>

      {loadError && accounts.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-sm font-medium theme-text-primary">{loadError}</p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => void loadAccounts(true)}
            >
              Thử lại
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table
                role="table"
                aria-label="Danh sách tài khoản"
                className="w-full min-w-[760px] text-left text-sm theme-text-secondary"
              >
                <thead className="border-b theme-border theme-surface-muted text-xs font-semibold theme-text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">Người dùng</th>
                    <th scope="col" className="px-5 py-3.5">Email</th>
                    <th scope="col" className="px-5 py-3.5">Vai trò</th>
                    <th scope="col" className="px-5 py-3.5">Ngày tham gia</th>
                    <th scope="col" className="px-5 py-3.5 text-center">Trạng thái</th>
                    <th scope="col" className="px-5 py-3.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y theme-border">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center theme-text-muted">
                        <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" aria-hidden="true" />
                        Đang tải danh sách tài khoản...
                      </td>
                    </tr>
                  ) : filteredAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center theme-text-muted">
                        {searchTerm.trim()
                          ? "Không có tài khoản nào phù hợp với tìm kiếm."
                          : activeTab === "teacher"
                            ? "Chưa có tài khoản giáo viên."
                            : "Chưa có tài khoản học sinh."}
                      </td>
                    </tr>
                  ) : (
                    filteredAccounts.map((account) => {
                      const role = effectiveRole(account);
                      return (
                        <tr
                          key={account.id}
                          tabIndex={0}
                          aria-haspopup="dialog"
                          onClick={() => void openAccountDetail(account)}
                          onKeyDown={(event) => handleRowKeyDown(event, account)}
                          className="cursor-pointer theme-hover-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                          title="Mở chi tiết tài khoản"
                        >
                          <td className="px-5 py-4 font-semibold theme-text-primary">
                            <div className="flex items-center gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border theme-border theme-surface-muted font-bold theme-text-primary">
                                {(account.fullName || account.email).charAt(0).toLocaleUpperCase()}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-bold">
                                  {account.fullName || "Chưa có tên"}
                                </span>
                                <span className="block truncate text-xs font-normal theme-text-muted">
                                  {account.firebaseUid || account.id}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4 font-mono text-xs theme-text-secondary">
                            {account.email}
                          </td>
                          <td className="px-5 py-4">{ROLE_LABELS[role]}</td>
                          <td className="px-5 py-4 text-xs theme-text-muted">
                            {formatDate(account.createdAt)}
                          </td>
                          <td className="px-5 py-4 text-center">
                            <Badge
                              variant={account.isBlocked ? "destructive" : "success"}
                              size="sm"
                              dot
                            >
                              {account.isBlocked ? "Đã bị khóa" : "Đang hoạt động"}
                            </Badge>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <Button
                              variant={account.isBlocked ? "primary" : "outline"}
                              size="sm"
                              className="min-h-11"
                              disabled={processingId === account.id}
                              isLoading={processingId === account.id}
                              onClick={(event) => void handleToggleBlock(account, event)}
                              leftIcon={
                                account.isBlocked
                                  ? <Unlock className="h-4 w-4" aria-hidden="true" />
                                  : <Lock className="h-4 w-4" aria-hidden="true" />
                              }
                            >
                              {account.isBlocked ? "Mở khóa" : "Khóa"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Modal
        isOpen={selectedAccount !== null}
        onClose={closeAccountDetail}
        title={accountForModal?.fullName || "Chi tiết tài khoản"}
        description={accountForModal?.email}
        size="xl"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {accountForModal && canReviewTeacher && (
                <>
                  <Button
                    size="sm"
                    className="min-h-11"
                    disabled={processingId === accountForModal.id}
                    isLoading={processingId === accountForModal.id}
                    onClick={() => void handleReviewTeacher("approve")}
                  >
                    Phê duyệt
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    disabled={processingId === accountForModal.id}
                    onClick={() => void handleReviewTeacher("reject")}
                  >
                    Từ chối
                  </Button>
                </>
              )}
              {accountForModal && (
                <Button
                  variant={accountForModal.isBlocked ? "primary" : "destructive"}
                  size="sm"
                  className="min-h-11"
                  disabled={processingId === accountForModal.id}
                  isLoading={processingId === accountForModal.id}
                  onClick={() => void handleToggleBlock(accountForModal)}
                  leftIcon={
                    accountForModal.isBlocked
                      ? <Unlock className="h-4 w-4" aria-hidden="true" />
                      : <Lock className="h-4 w-4" aria-hidden="true" />
                  }
                >
                  {accountForModal.isBlocked ? "Mở khóa" : "Khóa"}
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={closeAccountDetail}
            >
              Đóng
            </Button>
          </div>
        }
      >
        {detailLoading ? (
          <div className="py-12 text-center text-sm theme-text-muted">
            <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" aria-hidden="true" />
            Đang tải chi tiết tài khoản...
          </div>
        ) : detailError ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm theme-text-secondary">{detailError}</p>
            {selectedAccount && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => void openAccountDetail(selectedAccount)}
              >
                Thử lại
              </Button>
            )}
          </div>
        ) : accountDetail && accountForModal ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary" size="sm">
                {ROLE_LABELS[effectiveRole(accountForModal)]}
              </Badge>
              <Badge variant={accountForModal.isBlocked ? "destructive" : "success"} size="sm" dot>
                {accountForModal.isBlocked ? "Đã bị khóa" : "Đang hoạt động"}
              </Badge>
              <Badge
                variant={accountForModal.approvalStatus === "approved" ? "success" : "warning"}
                size="sm"
              >
                Trạng thái duyệt: {approvalLabel(accountForModal.approvalStatus)}
              </Badge>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border theme-border p-3">
                <dt className="text-xs theme-text-muted">Email</dt>
                <dd className="mt-1 break-all font-medium theme-text-primary">{accountForModal.email}</dd>
              </div>
              <div className="rounded-lg border theme-border p-3">
                <dt className="text-xs theme-text-muted">Ngày tạo tài khoản</dt>
                <dd className="mt-1 font-medium theme-text-primary">
                  {formatDate(accountForModal.createdAt)}
                </dd>
              </div>
              <div className="rounded-lg border theme-border p-3">
                <dt className="text-xs theme-text-muted">Vai trò cơ sở</dt>
                <dd className="mt-1 font-medium theme-text-primary">
                  {ROLE_LABELS[accountForModal.baseRole ?? accountForModal.role]}
                </dd>
              </div>
              <div className="rounded-lg border theme-border p-3">
                <dt className="text-xs theme-text-muted">Yêu cầu giáo viên</dt>
                <dd className="mt-1 font-medium theme-text-primary">
                  {approvalLabel(accountForModal.teacherRequestStatus ?? "none")}
                </dd>
              </div>
            </dl>

            <section aria-label="Thống kê hoạt động">
              <h3 className="mb-3 text-sm font-semibold theme-text-primary">Thống kê hoạt động</h3>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Lớp học" value={accountDetail.stats.classroomCount} />
                <StatCard label="Đề thi" value={accountDetail.stats.quizCount} />
                <StatCard label="Lượt làm" value={accountDetail.stats.attemptCount} />
                <StatCard label="Bài đã nộp" value={accountDetail.profile.submissionCount} />
              </div>
            </section>

            <section aria-label="Lớp học liên quan">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold theme-text-primary">Lớp học liên quan</h3>
                <span className="text-xs theme-text-muted">
                  {accountDetail.classrooms.length} lớp
                </span>
              </div>
              {accountDetail.classrooms.length === 0 ? (
                <p className="rounded-lg border border-dashed theme-border p-4 text-sm theme-text-muted">
                  Chưa có lớp học liên quan.
                </p>
              ) : (
                <ul className="space-y-2">
                  {accountDetail.classrooms.map((classroom) => (
                    <li
                      key={classroom.id}
                      className="flex flex-col gap-2 rounded-xl border theme-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold theme-text-primary">{classroom.name}</p>
                        <p className="text-xs theme-text-muted">
                          {[
                            classroom.subject,
                            classroom.gradeLevel && "Khối " + classroom.gradeLevel,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Chưa phân loại"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" size="sm">
                          {classroom.relationship === "owner" ? "Chủ lớp" : "Thành viên"}
                        </Badge>
                        <span className="text-xs theme-text-muted">
                          {classroom.memberCount} học sinh · {classroom.assignmentCount} bài tập
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Đề thi liên quan">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold theme-text-primary">Đề thi liên quan</h3>
                <span className="text-xs theme-text-muted">
                  {accountDetail.quizzes.length} đề
                </span>
              </div>
              {accountDetail.quizzes.length === 0 ? (
                <p className="rounded-lg border border-dashed theme-border p-4 text-sm theme-text-muted">
                  Chưa có đề thi do tài khoản này tạo.
                </p>
              ) : (
                <ul className="space-y-2">
                  {accountDetail.quizzes.map((quiz) => (
                    <li
                      key={quiz.id}
                      className="flex flex-col gap-3 rounded-xl border theme-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold theme-text-primary">{quiz.title}</p>
                        <p className="text-xs theme-text-muted">
                          {quiz.subject} · {quiz.totalQuestions ?? 0} câu · Mã {quiz.code}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            quiz.status === "published"
                              ? "success"
                              : quiz.status === "closed"
                                ? "destructive"
                                : "default"
                          }
                          size="sm"
                        >
                          {quiz.status === "published"
                            ? "Đang mở"
                            : quiz.status === "closed"
                              ? "Đã đóng"
                              : "Bản nháp"}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          onClick={() => {
                            closeAccountDetail();
                            navigate("/teacher/quiz/" + quiz.id + "/results");
                          }}
                          leftIcon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
                        >
                          Bảng điểm
                        </Button>
                        <Button
                          size="sm"
                          className="min-h-11"
                          onClick={() => {
                            closeAccountDetail();
                            navigate("/teacher/edit-quiz/" + quiz.id);
                          }}
                        >
                          Chỉnh sửa đề
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {accountDetail.recentResults.length > 0 && (
              <section aria-label="Kết quả gần đây">
                <h3 className="mb-3 text-sm font-semibold theme-text-primary">Kết quả gần đây</h3>
                <ul className="space-y-2">
                  {accountDetail.recentResults.map((result) => (
                    <li
                      key={result.id}
                      className="flex flex-col gap-2 rounded-xl border theme-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold theme-text-primary">{result.quizTitle}</p>
                        <p className="text-xs theme-text-muted">
                          {result.subject || "Đề thi"} · Nộp lúc {formatDate(result.submittedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={result.isPassed ? "success" : "warning"} size="sm">
                          {result.score === null ? "Ẩn điểm" : result.score + " điểm"}
                        </Badge>
                        {result.isLate && (
                          <Badge variant="warning" size="sm">Nộp muộn</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="border-t theme-border pt-5">
              <h3 className="mb-3 text-sm font-semibold theme-text-primary">Đổi vai trò</h3>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="w-full space-y-1.5 sm:max-w-xs">
                  <label htmlFor="account-role" className="text-xs font-semibold theme-text-secondary">
                    Vai trò
                  </label>
                  <select
                    id="account-role"
                    aria-label="Vai trò"
                    className="theme-control min-h-11 w-full rounded-lg border theme-border px-3 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                    value={roleDraft}
                    onChange={(event) => setRoleDraft(event.target.value as UserRole)}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                </div>
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={
                    processingId === accountForModal.id ||
                    roleDraft === effectiveRole(accountForModal)
                  }
                  isLoading={processingId === accountForModal.id}
                  onClick={() => void handleSaveRole()}
                >
                  Lưu vai trò
                </Button>
              </div>
            </section>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        isOpen={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (!confirmAction) return;
          const pending = confirmAction;
          setConfirmAction(null);
          if (pending.type === "block") {
            void executeToggleBlock(pending.account);
          } else {
            void executeSaveRole(pending.account, pending.toRole);
          }
        }}
        title={
          confirmAction?.type === "block"
            ? confirmAction.account.isBlocked
              ? "Mở khóa tài khoản"
              : "Khóa tài khoản"
            : "Đổi vai trò tài khoản"
        }
        description={
          confirmAction?.type === "block"
            ? `Bạn có chắc chắn muốn ${confirmAction.account.isBlocked ? "mở khóa" : "khóa"} tài khoản "${confirmAction.account.fullName}" (${confirmAction.account.email})?`
            : confirmAction?.type === "role"
              ? `Bạn có chắc muốn đổi vai trò của ${confirmAction.account.fullName} từ ${ROLE_LABELS[confirmAction.fromRole]} sang ${ROLE_LABELS[confirmAction.toRole]}?`
              : ""
        }
        confirmText={
          confirmAction?.type === "block"
            ? confirmAction.account.isBlocked
              ? "Mở khóa"
              : "Khóa"
            : "Lưu vai trò"
        }
        variant={confirmAction?.type === "block" && !confirmAction.account.isBlocked ? "destructive" : "primary"}
      />
    </div>
  );
}

export default AccountManagement;
