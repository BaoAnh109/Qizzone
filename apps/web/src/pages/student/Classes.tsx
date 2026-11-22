import { Card, CardContent } from "@/components/ui/Card";

export function Classes() {
  return (
    <div className="space-y-4">
      <h1 className="page-heading">Lớp học của tôi</h1>
      <Card>
        <CardContent className="p-6 text-sm theme-text-secondary">
          Danh sách lớp học bạn đã tham gia đang được chuẩn bị.
        </CardContent>
      </Card>
    </div>
  );
}

export default Classes;
