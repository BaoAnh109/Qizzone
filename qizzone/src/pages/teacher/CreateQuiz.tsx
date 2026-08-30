import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusCircle, Sparkles, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { useToast } from "@/hooks/useToast";

export function CreateQuiz() {
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("Toán học");
  const [duration, setDuration] = useState("45");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Vui lòng nhập tiêu đề đề thi!");
      return;
    }

    toast.success("Khởi tạo đề thi mới thành công!");
    navigate("/teacher/quizzes");
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between border-b border-neutral-200/80 pb-4">
        <div>
          <div className="flex items-center gap-1.5 text-indigo-600 text-xs font-semibold mb-1">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Teacher Portal · Quiz Builder</span>
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
            Tạo đề thi trắc nghiệm mới
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin chung & Cấu hình phòng thi</CardTitle>
          <CardDescription>
            Thiết lập tiêu đề, môn học và thời gian làm bài trước khi soạn câu hỏi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <Input
              label="Tiêu đề đề thi"
              placeholder="VD: Kiểm tra 1 tiết Đại số & Giải tích chương 1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Môn học"
                placeholder="VD: Toán học 12"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                leftIcon={<BookOpen className="h-4 w-4" />}
              />

              <Input
                label="Thời gian làm bài (Phút)"
                type="number"
                min={1}
                max={180}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>

            <Textarea
              label="Mô tả & Hướng dẫn làm bài"
              placeholder="Nhập hướng dẫn hoặc lưu ý cho thí sinh khi làm bài..."
              rows={3}
            />

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-100">
              <Button variant="outline" onClick={() => navigate("/teacher")}>
                Hủy bỏ
              </Button>
              <Button
                type="submit"
                variant="primary"
                leftIcon={<PlusCircle className="h-4 w-4" />}
              >
                Tiếp tục soạn câu hỏi
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default CreateQuiz;
