import { useState } from "react";
import {
  Sparkles,
  Send,
  Trash2,
  Lock,
  Mail,
  Search,
  CheckCircle,
  AlertTriangle,
  Info,
  Layers,
  Component,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";

export function DesignSystemShowcase() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalSize, setModalSize] = useState<"sm" | "md" | "lg" | "xl">("md");
  const [buttonLoading, setButtonLoading] = useState(false);
  const toast = useToast();

  const handleSimulateLoading = () => {
    setButtonLoading(true);
    setTimeout(() => {
      setButtonLoading(false);
      toast.success("Thao tác xử lý nền hoàn tất thành công!");
    }, 1500);
  };

  return (
    <div className="space-y-10 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 text-sm font-semibold mb-1">
            <Component className="h-4 w-4" />
            <span>Design System & UI Primitives</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
            Qizzone UI Component Showcase
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Tổng hợp bộ thư viện component nguyên tử chuẩn WAI-ARIA & Responsive theo Epic QIZ-EP1.
          </p>
        </div>

        <Badge variant="primary" size="md" dot>
          Tailwind CSS v4 + React 19
        </Badge>
      </div>

      {/* 1. BUTTONS SECTION */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-neutral-900">
            1. Button Component & Variants
          </h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Button Variants & States</CardTitle>
            <CardDescription>
              Hỗ trợ đầy đủ các biến thể màu sắc, kích thước và trạng thái loading/disabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Variants */}
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                Variants
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary">Primary</Button>
                <Button variant="default">Default Neutral</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link Style</Button>
              </div>
            </div>

            {/* Sizes */}
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                Sizes (sm, md, lg)
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="primary">Small (sm)</Button>
                <Button size="md" variant="primary">Medium (md)</Button>
                <Button size="lg" variant="primary">Large (lg)</Button>
              </div>
            </div>

            {/* Icons & Loading */}
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                With Icons & Dynamic Loading
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  leftIcon={<Sparkles className="h-4 w-4" />}
                >
                  Icon Trái
                </Button>
                <Button
                  variant="outline"
                  rightIcon={<Send className="h-4 w-4" />}
                >
                  Icon Phải
                </Button>
                <Button
                  variant="destructive"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                >
                  Xóa đề thi
                </Button>
                <Button
                  variant="primary"
                  isLoading={buttonLoading}
                  onClick={handleSimulateLoading}
                >
                  {buttonLoading ? "Đang xử lý..." : "Bấm để test Spinner Loading"}
                </Button>
                <Button variant="primary" disabled>
                  Disabled State
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 2. FORM CONTROLS (INPUT & TEXTAREA) */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-neutral-900">
            2. Form Controls (Input & Textarea)
          </h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Input & Textarea Fields</CardTitle>
            <CardDescription>
              Hỗ trợ prefix icon, helper text, thông báo lỗi xác thực Zod và trạng thái disabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="Họ và tên"
                placeholder="Nguyễn Văn A"
                helperText="Nhập đầy đủ họ tên như trong danh sách lớp."
              />

              <Input
                label="Địa chỉ Email"
                placeholder="teacher@qizzone.edu.vn"
                type="email"
                leftIcon={<Mail className="h-4 w-4" />}
              />

              <Input
                label="Mật khẩu"
                type="password"
                placeholder="••••••••"
                leftIcon={<Lock className="h-4 w-4" />}
              />

              <Input
                label="Tìm kiếm đề thi"
                placeholder="Nhập tên đề thi, mã phòng..."
                leftIcon={<Search className="h-4 w-4" />}
                rightIcon={<Badge size="sm" variant="default">ESC</Badge>}
              />

              <Input
                label="Trường hợp Lỗi Xác Thực"
                defaultValue="invalid-email"
                error="Email không đúng định dạng chuẩn (@qizzone.edu.vn)"
                leftIcon={<Mail className="h-4 w-4" />}
              />

              <Input
                label="Trường hợp Bị Khóa (Disabled)"
                value="QZ-8899 (Mã phòng cố định)"
                disabled
              />

              <div className="md:col-span-2">
                <Textarea
                  label="Nội dung câu hỏi hoặc Ghi chú bài giảng"
                  placeholder="Nhập nội dung câu hỏi hoặc công thức Toán $x^2 + y^2 = r^2$..."
                  helperText="Hỗ trợ cú pháp Markdown và công thức KaTeX."
                  rows={3}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 3. BADGES & QUIZ STATUSES */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-neutral-900">
            3. Badge Status Indicators
          </h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Badges & Statuses</CardTitle>
            <CardDescription>
              Trực quan hóa trạng thái đề thi (`Draft`, `Published`, `Closed`, `Active`) và mức độ cảnh báo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                Trạng thái Đề thi (Quiz Statuses)
              </p>
              <div className="flex flex-wrap gap-3">
                <Badge variant="draft" dot>Bản nháp (Draft)</Badge>
                <Badge variant="published" dot>Đã xuất bản (Published)</Badge>
                <Badge variant="active" dot>Đang mở phòng (Active)</Badge>
                <Badge variant="closed" dot>Đã đóng (Closed)</Badge>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
                General Variants & Sizes
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="primary">Primary</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="primary" size="sm">Small Size (sm)</Badge>
                <Badge variant="primary" size="md">Medium Size (md)</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 4. TOAST NOTIFICATIONS & MODAL DIALOG */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-neutral-900">
            4. Toast System & Modal Dialog
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Toast Triggers */}
          <Card>
            <CardHeader>
              <CardTitle>Hệ thống Thông báo Toast</CardTitle>
              <CardDescription>
                Tự động hiển thị và biến mất (Auto-dismiss), hỗ trợ 4 cấp độ thông điệp.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                leftIcon={<CheckCircle className="h-4 w-4" />}
                onClick={() => toast.success("Đề thi đã được lưu và tạo mã phòng thành công!", "Xuất bản thành công")}
              >
                Kích hoạt Toast Success
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start text-rose-700 border-rose-200 hover:bg-rose-50"
                leftIcon={<AlertTriangle className="h-4 w-4" />}
                onClick={() => toast.error("Vui lòng kiểm tra lại kết nối mạng hoặc phiên đăng nhập.", "Không thể nộp bài")}
              >
                Kích hoạt Toast Error
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start text-amber-700 border-amber-200 hover:bg-amber-50"
                leftIcon={<AlertTriangle className="h-4 w-4" />}
                onClick={() => toast.warning("Thời gian làm bài chỉ còn dưới 5 phút!", "Cảnh báo thời gian")}
              >
                Kích hoạt Toast Warning
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                leftIcon={<Info className="h-4 w-4" />}
                onClick={() => toast.info("Hệ thống đã tự động lưu nháp đáp án của bạn vào bộ nhớ đệm.", "Đã lưu tự động")}
              >
                Kích hoạt Toast Info
              </Button>
            </CardContent>
          </Card>

          {/* Modal Triggers */}
          <Card>
            <CardHeader>
              <CardTitle>Modal / Dialog Triggers</CardTitle>
              <CardDescription>
                Hộp thoại tương tác hỗ trợ Backdrop Blur, ESC key close và nhiều kích cỡ.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setModalSize("sm"); setIsModalOpen(true); }}
                >
                  Modal Small (sm)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setModalSize("md"); setIsModalOpen(true); }}
                >
                  Modal Medium (md)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setModalSize("lg"); setIsModalOpen(true); }}
                >
                  Modal Large (lg)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setModalSize("xl"); setIsModalOpen(true); }}
                >
                  Modal Extra Large (xl)
                </Button>
              </div>

              <div className="pt-2">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => { setModalSize("md"); setIsModalOpen(true); }}
                >
                  Mở Modal Xác nhận Mẫu
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Interactive Demo Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size={modalSize}
        title="Xác nhận nộp bài thi trắc nghiệm"
        description="Vui lòng kiểm tra lại số câu đã hoàn thành trước khi gửi bài chấm điểm."
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Hủy bỏ
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setIsModalOpen(false);
                toast.success("Bài thi của bạn đã được gửi chấm điểm thành công!");
              }}
            >
              Xác nhận nộp bài
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-neutral-600">
          <div className="rounded-xl bg-amber-50 p-4 border border-amber-200 text-amber-900">
            <p className="font-semibold text-xs uppercase tracking-wider mb-1">
              Thống kê bài làm hiện tại:
            </p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Số câu đã hoàn thành: <strong>18 / 20 câu</strong></li>
              <li>Số câu chưa trả lời: <strong className="text-rose-600">2 câu</strong></li>
              <li>Thời gian còn lại: <strong>14 phút 25 giây</strong></li>
            </ul>
          </div>
          <p>
            Sau khi nộp bài, hệ thống sẽ khóa toàn bộ đáp án và tiến hành chấm điểm tự động tức thì. Bạn có chắc chắn muốn nộp ngay bây giờ?
          </p>
        </div>
      </Modal>
    </div>
  );
}

export default DesignSystemShowcase;
