import { Card, CardContent } from "@/components/ui/Card";

export function Classes() {
  return (
    <div className="space-y-4">
      <h1 className="page-heading">Quản lý lớp học</h1>
      <Card>
        <CardContent className="p-6 text-sm theme-text-secondary">
          Không gian quản lý lớp học của giáo viên đang được chuẩn bị.
        </CardContent>
      </Card>
    </div>
  );
}

export default Classes;
