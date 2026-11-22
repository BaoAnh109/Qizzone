import { Card, CardContent } from "@/components/ui/Card";

export function JoinClassByLink() {
  return (
    <div className="mx-auto max-w-lg py-12 px-4">
      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <h1 className="page-heading">Tham gia lớp học</h1>
          <p className="text-sm theme-text-secondary">
            Liên kết tham gia lớp học bằng mã mời đang được chuẩn bị.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default JoinClassByLink;
