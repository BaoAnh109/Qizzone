import { Card, CardContent } from "@/components/ui/Card";

export function ClassDetail() {
  return (
    <div className="space-y-4">
      <h1 className="page-heading">Chi tiết lớp học</h1>
      <Card>
        <CardContent className="p-6 text-sm theme-text-secondary">
          Chi tiết danh sách học sinh và bài tập giao trong lớp đang được chuẩn bị.
        </CardContent>
      </Card>
    </div>
  );
}

export default ClassDetail;
