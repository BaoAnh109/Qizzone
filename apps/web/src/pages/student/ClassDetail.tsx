import { Card, CardContent } from "@/components/ui/Card";

export function ClassDetail() {
  return (
    <div className="space-y-4">
      <h1 className="page-heading">Chi tiết lớp học</h1>
      <Card>
        <CardContent className="p-6 text-sm theme-text-secondary">
          Danh sách bài tập và đề thi của lớp đang được chuẩn bị.
        </CardContent>
      </Card>
    </div>
  );
}

export default ClassDetail;
