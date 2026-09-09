import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, RefreshCw, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { adminService, type TeacherApprovalRequest } from "@/services/adminService";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/hooks/useToast";

export function TeacherApprovals() {
  const [requests, setRequests] = useState<TeacherApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingUid, setProcessingUid] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRequests(await adminService.listTeacherApprovals());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải danh sách chờ duyệt.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    adminService.listTeacherApprovals()
      .then(data => { if (active) setRequests(data); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Không thể tải danh sách chờ duyệt."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  const review = async (request: TeacherApprovalRequest, action: "approve" | "reject") => {
    if (action === "reject" && !window.confirm(`Từ chối yêu cầu giáo viên của ${request.fullName}?`)) return;
    setProcessingUid(request.firebaseUid);
    try {
      if (action === "approve") await adminService.approveTeacher(request.firebaseUid);
      else await adminService.rejectTeacher(request.firebaseUid);
      setRequests(current => current.filter(item => item.firebaseUid !== request.firebaseUid));
      toast.success(
        action === "approve" ? "Giáo viên đã được duyệt và có thể đăng nhập lại." : "Yêu cầu giáo viên đã bị từ chối.",
        action === "approve" ? "Đã xét duyệt" : "Đã từ chối",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể cập nhật yêu cầu.");
    } finally {
      setProcessingUid(null);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Quản trị hệ thống
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">Duyệt tài khoản giáo viên</h1>
          <p className="mt-1 text-sm text-neutral-500">Chỉ tài khoản được duyệt mới nhận quyền giáo viên và đăng nhập vào hệ thống.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} isLoading={isLoading} leftIcon={<RefreshCw className="h-4 w-4" />}>
          Làm mới
        </Button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>Thử lại</Button>
        </div>
      )}

      {!isLoading && !error && requests.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-14 text-center">
            <UserRoundCheck className="mb-3 h-10 w-10 text-emerald-500" />
            <h2 className="font-semibold text-neutral-900">Không có yêu cầu đang chờ</h2>
            <p className="mt-1 text-sm text-neutral-500">Các yêu cầu đăng ký giáo viên mới sẽ xuất hiện tại đây.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {requests.map(request => (
          <Card key={request.firebaseUid}>
            <CardHeader className="pb-3">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <CardTitle className="text-base">{request.fullName}</CardTitle>
                  <CardDescription className="mt-1">{request.email}</CardDescription>
                </div>
                <Badge variant="warning" dot>Chờ xét duyệt</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col justify-between gap-4 border-t border-neutral-100 pt-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Clock3 className="h-4 w-4" />
                Gửi lúc {new Date(request.requestedAt).toLocaleString("vi-VN")}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={processingUid !== null} onClick={() => void review(request, "reject")} leftIcon={<X className="h-4 w-4" />}>
                  Từ chối
                </Button>
                <Button size="sm" disabled={processingUid !== null} isLoading={processingUid === request.firebaseUid} onClick={() => void review(request, "approve")} leftIcon={<Check className="h-4 w-4" />}>
                  Phê duyệt
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default TeacherApprovals;
