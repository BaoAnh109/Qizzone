import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, ArrowRight, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { useToast } from "@/hooks/useToast";

export function StudentDashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [roomCode, setRoomCode] = useState("");
  const [studentName, setStudentName] = useState("");
  const [error, setError] = useState("");

  const handleJoinExam = (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();

    if (!code) {
      setError("Vui lòng nhập mã phòng thi 6 ký tự");
      return;
    }
    if (code.length < 4) {
      setError("Mã phòng thi không hợp lệ (ví dụ: QZ9821)");
      return;
    }

    toast.info(`Đang kết nối vào phòng thi ${code}...`);
    navigate(`/student/quiz/${code}?name=${encodeURIComponent(studentName || "Thí sinh")}`);
  };

  return (
    <div className="max-w-xl mx-auto space-y-8 py-4">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/80 px-3 py-1 text-xs font-semibold text-indigo-700">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Cổng vào phòng thi trực tuyến</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
          Tham gia phòng thi Qizzone
        </h1>
        <p className="text-sm text-neutral-500 max-w-md mx-auto">
          Nhập mã phòng do Thầy Cô cung cấp để bắt đầu làm bài trắc nghiệm.
        </p>
      </div>

      <Card className="shadow-lg border-neutral-200/80">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-2">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle className="text-lg">Nhập mã phòng thi</CardTitle>
          <CardDescription>
            Mã gồm 6 ký tự chữ và số (ví dụ: <span className="font-mono font-semibold text-neutral-800">QZ9821</span>)
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleJoinExam} className="space-y-4">
            <Input
              label="Họ và tên thí sinh"
              placeholder="Nhập họ và tên của bạn"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
            />

            <Input
              label="Mã phòng thi"
              placeholder="VD: QZ9821"
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value.toUpperCase());
                if (error) setError("");
              }}
              error={error}
              className="font-mono text-center tracking-widest text-lg uppercase font-bold"
              maxLength={8}
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full h-11 text-sm font-semibold"
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Vào phòng thi
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Rules Notice */}
      <div className="rounded-xl bg-amber-50/70 p-4 border border-amber-200/80 text-amber-900 flex gap-3 text-xs leading-relaxed">
        <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-0.5">Lưu ý trước khi vào thi:</p>
          <p>
            Hệ thống có cơ chế <strong>Auto-Save tự động lưu đáp án</strong> theo thời gian thực. Hãy giữ kết nối mạng ổn định và không đóng trình duyệt trong khi đang làm bài.
          </p>
        </div>
      </div>
    </div>
  );
}

export default StudentDashboard;
