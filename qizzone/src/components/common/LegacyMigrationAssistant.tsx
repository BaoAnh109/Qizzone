import { useMemo, useState } from 'react';
import { AlertTriangle, Database, Download, ShieldCheck } from 'lucide-react';
import type { User } from '@/types/auth';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import {
  exportLegacyBackup,
  getLegacyMigrationPreview,
  migrateLegacyData,
} from '@/services/legacyMigrationService';

interface Props {
  user: User;
  onCompleted: () => Promise<void>;
}

export function LegacyMigrationAssistant({ user, onCompleted }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const preview = useMemo(() => getLegacyMigrationPreview(user), [user]);
  const toast = useToast();
  const isOpen = preview.hasLegacyData && !dismissed;

  const migrate = async () => {
    setIsMigrating(true);
    try {
      await migrateLegacyData(user);
      await onCompleted();
      setDismissed(true);
      const imported = preview.profileCount + preview.quizCount + preview.attemptCount + preview.resultCount;
      toast.success(
        `Server đã xác nhận xử lý ${imported} bản ghi hợp lệ${preview.skippedCount ? `; bỏ qua ${preview.skippedCount} bản ghi không xác minh được` : ''}.`,
        'Chuyển dữ liệu thành công',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể chuyển dữ liệu.', 'Dữ liệu cũ vẫn được giữ nguyên');
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setDismissed(true)}
      title="Phát hiện dữ liệu Qizzone cũ"
      description="Xem trước, tải bản sao dự phòng rồi chuyển dữ liệu hợp lệ lên tài khoản đang đăng nhập."
      size="lg"
      closeOnOverlayClick={!isMigrating}
      closeOnEsc={!isMigrating}
      showCloseButton={!isMigrating}
      footer={(
        <>
          <Button variant="outline" onClick={() => exportLegacyBackup(user)} leftIcon={<Download className="h-4 w-4" />}>
            Tải JSON dự phòng
          </Button>
          <Button onClick={() => void migrate()} isLoading={isMigrating} leftIcon={<Database className="h-4 w-4" />}>
            Xác nhận chuyển dữ liệu
          </Button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-neutral-700">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['Hồ sơ', preview.profileCount],
            ['Đề thi', preview.quizCount],
            ['Bài đang làm', preview.attemptCount],
            ['Kết quả', preview.resultCount],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center">
              <div className="text-xl font-bold text-indigo-700">{value}</div>
              <div className="text-xs text-neutral-500">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
          <ShieldCheck className="h-5 w-5 shrink-0" />
          <p>Chỉ dữ liệu khớp email và mã người dùng cũ mới được nhập. Mật khẩu, token giả và Gemini API key không bao giờ được tải lên.</p>
        </div>
        {(preview.skippedCount > 0 || !preview.hasMatchingProfile) && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p>
              {preview.skippedCount > 0 ? `${preview.skippedCount} bản ghi không chứng minh được quyền sở hữu hoặc không hợp lệ sẽ được ghi nhận là bỏ qua. ` : ''}
              {!preview.hasMatchingProfile ? 'Không tìm thấy hồ sơ cũ khớp email hiện tại. ' : ''}
              Hãy tải JSON dự phòng trước khi tiếp tục nếu bạn cần đối chiếu sau này.
            </p>
          </div>
        )}
        {(preview.hasUnsafeGeminiKey || preview.hasObsoleteSession) && (
          <p className="text-xs text-neutral-500">
            Khóa Gemini cũ (nếu có) và phiên đăng nhập giả lập chỉ được xóa sau khi server ghi nhận migration; chúng không được chuyển sang cloud.
          </p>
        )}
      </div>
    </Modal>
  );
}

export default LegacyMigrationAssistant;
