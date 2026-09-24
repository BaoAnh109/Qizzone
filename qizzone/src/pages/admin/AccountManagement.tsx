import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  GraduationCap,
  Search,
  Lock,
  Unlock,
  BookOpen,
  Edit,
  BarChart2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { adminService, type UserAccount } from "@/services/adminService";
import { useQuizStore } from "@/store/quizStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import type { Quiz } from "@/types/quiz";

export function AccountManagement() {
  const navigate = useNavigate();
  const toast = useToast();
  const quizzes = useQuizStore((state) => state.quizzes);

  const [activeTab, setActiveTab] = useState<"teacher" | "student">("teacher");
  const [searchTerm, setSearchTerm] = useState("");
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Modal for teacher's quizzes
  const [selectedTeacher, setSelectedTeacher] = useState<UserAccount | null>(null);
  const [isQuizzesModalOpen, setIsQuizzesModalOpen] = useState(false);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await adminService.listAccounts();
      setAccounts(data);
    } catch {
      toast.error("Không thể tải danh sách tài khoản.");
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const handleToggleBlock = async (account: UserAccount) => {
    const nextBlocked = !account.isBlocked;
    const confirmMessage = nextBlocked
      ? `Bạn có chắc chắn muốn khóa tài khoản "${account.fullName}" (${account.email})?`
      : `Bạn có muốn mở khóa tài khoản "${account.fullName}" (${account.email})?`;

    if (!window.confirm(confirmMessage)) return;

    setProcessingId(account.id);
    try {
      await adminService.toggleBlockUser(account.id, nextBlocked);
      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === account.id ? { ...acc, isBlocked: nextBlocked } : acc
        )
      );
      toast.success(
        nextBlocked
          ? `Đã khóa tài khoản "${account.fullName}" thành công.`
          : `Đã mở khóa tài khoản "${account.fullName}" thành công.`
      );
    } catch {
      toast.error("Không thể thay đổi trạng thái tài khoản. Vui lòng thử lại!");
    } finally {
      setProcessingId(null);
    }
  };

  const handleOpenTeacherQuizzes = (teacher: UserAccount) => {
    setSelectedTeacher(teacher);
    setIsQuizzesModalOpen(true);
  };

  const teachersList = accounts.filter((acc) => acc.role === "teacher");
  const studentsList = accounts.filter((acc) => acc.role === "student");

  const currentTabAccounts = activeTab === "teacher" ? teachersList : studentsList;

  const filteredAccounts = currentTabAccounts.filter((acc) => {
    const term = searchTerm.toLowerCase();
    return (
      acc.fullName.toLowerCase().includes(term) ||
      acc.email.toLowerCase().includes(term)
    );
  });

  // Calculate actual quizzes for selected teacher
  const teacherQuizzes: Quiz[] = selectedTeacher
    ? quizzes.filter(
        (q) =>
          q.teacherId === selectedTeacher.id ||
          q.teacherId === selectedTeacher.firebaseUid
      )
    : [];

  return (
    <div className="space-y-6 pb-16">
      {/* Top Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center border-b border-neutral-200 pb-5">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            <Users className="h-3.5 w-3.5" /> Quản trị người dùng
          </div>
          <h1 className="page-heading">Quản lý tài khoản</h1>
          <p className="page-description">
            Quản trị và phân quyền danh sách Giáo viên và Học sinh trong toàn bộ hệ thống.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadAccounts}
          disabled={isLoading}
          leftIcon={<RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />}
        >
          Làm mới
        </Button>
      </div>

      {/* Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Role Tabs */}
        <div className="inline-flex rounded-xl bg-neutral-100 p-1 border border-neutral-200">
          <button
            type="button"
            onClick={() => setActiveTab("teacher")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition cursor-pointer ${
              activeTab === "teacher"
                ? "bg-white text-indigo-700 shadow-xs font-bold"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            <GraduationCap className="h-4 w-4" />
            <span>Giáo viên</span>
            <span className="ml-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">
              {teachersList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("student")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition cursor-pointer ${
              activeTab === "student"
                ? "bg-white text-indigo-700 shadow-xs font-bold"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            <Users className="h-4 w-4" />
            <span>Học sinh</span>
            <span className="ml-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">
              {studentsList.length}
            </span>
          </button>
        </div>

        {/* Search Input */}
        <div className="w-full sm:max-w-xs">
          <Input
            placeholder="Tìm theo tên hoặc email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>
      </div>

      {/* Accounts Table Card */}
      <Card className="overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-neutral-600">
            <thead className="bg-neutral-50/80 text-xs uppercase text-neutral-500 font-semibold border-b border-neutral-200">
              <tr>
                <th className="px-5 py-3.5">Người dùng</th>
                <th className="px-5 py-3.5">Email</th>
                <th className="px-5 py-3.5 text-center">
                  {activeTab === "teacher" ? "Đề thi đã tạo" : "Số bài đã nộp"}
                </th>
                <th className="px-5 py-3.5">Ngày tham gia</th>
                <th className="px-5 py-3.5 text-center">Trạng thái</th>
                <th className="px-5 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-neutral-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-600" />
                    Đang tải danh sách tài khoản...
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-neutral-400">
                    Không có tài khoản nào phù hợp với tìm kiếm.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((account) => {
                  const teacherQuizzesCount =
                    account.role === "teacher"
                      ? quizzes.filter(
                          (q) =>
                            q.teacherId === account.id ||
                            q.teacherId === account.firebaseUid
                        ).length || account.quizCount || 0
                      : 0;

                  return (
                    <tr
                      key={account.id}
                      className="hover:bg-neutral-50/70 transition"
                    >
                      <td className="px-5 py-4 font-semibold text-neutral-900">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-indigo-700 text-sm">
                            {account.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-neutral-900">
                              {account.fullName}
                            </p>
                            <p className="text-xs text-neutral-400 font-normal font-mono">
                              ID: {account.id}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4 font-mono text-xs text-neutral-700">
                        {account.email}
                      </td>

                      <td className="px-5 py-4 text-center font-mono font-bold text-neutral-900">
                        {activeTab === "teacher" ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-0.5 text-xs text-indigo-700">
                            {teacherQuizzesCount} đề
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700">
                            {account.submissionCount ?? 0} bài
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-xs text-neutral-500">
                        {new Date(account.createdAt).toLocaleDateString("vi-VN")}
                      </td>

                      <td className="px-5 py-4 text-center">
                        {account.isBlocked ? (
                          <Badge variant="destructive" size="sm" dot>
                            Đã bị khóa
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm" dot>
                            Đang hoạt động
                          </Badge>
                        )}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {account.role === "teacher" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs font-semibold text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                              onClick={() => handleOpenTeacherQuizzes(account)}
                              leftIcon={<BookOpen className="h-3.5 w-3.5" />}
                            >
                              Xem đề ({teacherQuizzesCount})
                            </Button>
                          )}

                          <Button
                            variant={account.isBlocked ? "primary" : "outline"}
                            size="sm"
                            disabled={processingId === account.id}
                            className={`text-xs font-semibold ${
                              account.isBlocked
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                : "text-rose-700 border-rose-200 hover:bg-rose-50"
                            }`}
                            onClick={() => handleToggleBlock(account)}
                            leftIcon={
                              account.isBlocked ? (
                                <Unlock className="h-3.5 w-3.5" />
                              ) : (
                                <Lock className="h-3.5 w-3.5" />
                              )
                            }
                          >
                            {account.isBlocked ? "Mở khóa" : "Khóa"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Teacher Quizzes Modal */}
      <Modal
        isOpen={isQuizzesModalOpen}
        onClose={() => setIsQuizzesModalOpen(false)}
        title={`Đề thi của giáo viên: ${selectedTeacher?.fullName || ""}`}
        description={`Email: ${selectedTeacher?.email || ""} · Admin có toàn quyền chỉnh sửa và xem kết quả.`}
        size="lg"
      >
        <div className="space-y-4 pt-2">
          {teacherQuizzes.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 border border-dashed rounded-xl">
              <ShieldAlert className="h-8 w-8 text-neutral-400 mx-auto mb-2" />
              <p className="text-sm font-semibold">Giáo viên này chưa khởi tạo đề thi nào trong hệ thống.</p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
              {teacherQuizzes.map((quiz) => (
                <div
                  key={quiz.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 transition"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" size="sm">
                        {quiz.subject}
                      </Badge>
                      <Badge variant={quiz.status} size="sm" dot>
                        {quiz.status === "published"
                          ? "Đang mở"
                          : quiz.status === "draft"
                          ? "Bản nháp"
                          : "Đã đóng"}
                      </Badge>
                      <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                        {quiz.code}
                      </span>
                    </div>

                    <h4 className="font-bold text-neutral-900 text-sm truncate">
                      {quiz.title}
                    </h4>

                    <p className="text-xs text-neutral-500">
                      Số câu: <strong>{quiz.totalQuestions}</strong> · Thời gian:{" "}
                      <strong>
                        {quiz.settings.durationMinutes === 0
                          ? "Vô thời hạn"
                          : `${quiz.settings.durationMinutes} phút`}
                      </strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsQuizzesModalOpen(false);
                        navigate(`/teacher/quiz/${quiz.id}/results`);
                      }}
                      leftIcon={<BarChart2 className="h-3.5 w-3.5 text-indigo-600" />}
                      className="text-xs font-semibold"
                    >
                      Bảng điểm
                    </Button>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setIsQuizzesModalOpen(false);
                        navigate(`/teacher/edit-quiz/${quiz.id}`);
                      }}
                      leftIcon={<Edit className="h-3.5 w-3.5" />}
                      className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700"
                    >
                      Chỉnh sửa đề
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-3 border-t border-neutral-200">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsQuizzesModalOpen(false)}
            >
              Đóng
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default AccountManagement;
