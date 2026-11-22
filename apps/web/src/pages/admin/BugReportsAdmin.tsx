import { Card, CardContent } from "@/components/ui/Card";

export function BugReportsAdmin() {
  return (
    <div className="space-y-4">
      <h1 className="page-heading">Quản lý báo lỗi</h1>
      <Card>
        <CardContent className="p-6 text-sm theme-text-secondary">
          Danh sách báo lỗi từ giáo viên và học sinh sẽ được hoàn thiện ở giai đoạn tiếp theo.
        </CardContent>
      </Card>
    </div>
  );
}

export default BugReportsAdmin;
