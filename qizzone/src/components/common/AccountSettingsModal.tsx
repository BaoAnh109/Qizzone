import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { uploadAccountAvatar } from '@/services/accountSettingsService';
import { useAuthStore } from '@/store/authStore';

type SettingsTab = 'profile' | 'password';

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AccountSettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const user = useAuthStore(state => state.user);
  const resetPassword = useAuthStore(state => state.resetPassword);
  const updateProfile = useAuthStore(state => state.updateProfile);

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [fullName, setFullName] = useState(() => user?.fullName || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [isSendingResetLink, setIsSendingResetLink] = useState(false);

  useEffect(() => {
    if (!previewUrl?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const isBusy = isSavingProfile || isSendingResetLink;
  const avatarSrc = previewUrl || user?.avatarUrl;
  const avatarInitial = fullName.trim().charAt(0).toUpperCase() || 'Q';

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setProfileError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setProfileError('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError('Ảnh đại diện phải nhỏ hơn 2 MB.');
      return;
    }
    setAvatarFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = fullName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setProfileError('Tên cần có từ 2 đến 100 ký tự.');
      return;
    }
    if (!user) return;

    setIsSavingProfile(true);
    setProfileError(null);
    try {
      let avatarUrl = user.avatarUrl;
      if (avatarFile) {
        const uploaded = await uploadAccountAvatar(avatarFile);
        avatarUrl = uploaded.avatarUrl;
      }
      await updateProfile({ fullName: trimmedName, avatarUrl });
      toast.success('Thông tin tài khoản đã được cập nhật.');
      onClose();
    } catch (error) {
      const message = formatError(error, 'Không thể lưu thông tin tài khoản.');
      setProfileError(message);
      toast.error(message, 'Không thể cập nhật tài khoản');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSendResetLink = async () => {
    const email = user?.email?.trim();
    if (!email) {
      setPasswordError('Tài khoản chưa có email để nhận liên kết đặt lại mật khẩu.');
      return;
    }

    setIsSendingResetLink(true);
    setPasswordError(null);
    setPasswordStatus(null);
    try {
      await resetPassword(email);
      setPasswordStatus(`Email đặt lại mật khẩu đã được gửi đến ${email}. Mở email và làm theo liên kết của Firebase. Nếu chưa thấy, hãy kiểm tra thư mục Spam.`);
      toast.success('Email đặt lại mật khẩu đã được gửi.', 'Kiểm tra hộp thư');
    } catch (error) {
      const message = formatError(error, 'Không thể gửi liên kết đặt lại mật khẩu. Vui lòng thử lại.');
      setPasswordError(message);
      toast.error(message, 'Không thể gửi email');
    } finally {
      setIsSendingResetLink(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !isBusy && onClose()}
      closeOnEsc={!isBusy}
      closeOnOverlayClick={!isBusy}
      title={<span className="theme-text-primary">Cài đặt tài khoản</span>}
      description={<span className="theme-text-muted">Quản lý thông tin cá nhân và bảo mật.</span>}
      size="lg"
      className="rounded-2xl"
    >
      <div className="space-y-5">
        <div role="tablist" aria-label="Cài đặt tài khoản" className="grid grid-cols-2 gap-2 rounded-xl border theme-border theme-surface-muted p-1">
          <button
            type="button"
            role="tab"
            id="account-profile-tab"
            aria-selected={activeTab === 'profile'}
            aria-controls="account-profile-panel"
            onClick={() => setActiveTab('profile')}
            className={`flex h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 sm:gap-2 sm:px-3 sm:text-sm ${activeTab === 'profile' ? 'theme-surface-raised theme-text-primary shadow-sm' : 'theme-text-muted hover:text-neutral-900'}`}
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Thông tin cá nhân
          </button>
          <button
            type="button"
            role="tab"
            id="account-password-tab"
            aria-selected={activeTab === 'password'}
            aria-controls="account-password-panel"
            onClick={() => setActiveTab('password')}
            className={`flex h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 sm:gap-2 sm:px-3 sm:text-sm ${activeTab === 'password' ? 'theme-surface-raised theme-text-primary shadow-sm' : 'theme-text-muted hover:text-neutral-900'}`}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Mật khẩu
          </button>
        </div>

        {activeTab === 'profile' ? (
          <section role="tabpanel" id="account-profile-panel" aria-labelledby="account-profile-tab">
            <form onSubmit={event => void handleSaveProfile(event)} className="space-y-5">
              <div className="flex flex-col items-center gap-3 rounded-xl border theme-border theme-surface-muted p-4 sm:flex-row sm:items-center sm:gap-4">
                {avatarSrc ? (
                  <img src={avatarSrc} alt="Xem trước ảnh đại diện" className="h-20 w-20 rounded-full border-2 theme-border object-cover shadow-sm" />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--status-info-surface)] text-2xl font-semibold text-[var(--status-info-foreground)]" role="img" aria-label={`Ảnh đại diện chữ ${avatarInitial}`}>
                    {avatarInitial}
                  </span>
                )}
                <div className="text-center sm:text-left">
                  <p className="text-sm font-semibold theme-text-primary">Ảnh đại diện</p>
                  <p className="mt-1 text-xs leading-5 theme-text-muted">JPG, PNG hoặc WebP · tối đa 2 MB</p>
                  <input
                    id="account-avatar-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="peer sr-only"
                    aria-label="Chọn ảnh đại diện JPG, PNG hoặc WebP"
                    disabled={isSavingProfile}
                    onChange={handleAvatarChange}
                  />
                  <label htmlFor="account-avatar-file" className={`mt-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border theme-border theme-surface-raised px-3 text-sm font-medium theme-text-secondary transition hover:bg-neutral-100 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 ${isSavingProfile ? 'pointer-events-none opacity-50' : ''}`}>
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    Chọn ảnh
                  </label>
                </div>
              </div>

              <Input
                id="account-full-name"
                label="Họ và tên"
                value={fullName}
                maxLength={100}
                autoComplete="name"
                onChange={event => setFullName(event.target.value)}
                helperText="Tên này sẽ hiển thị trong hồ sơ và các hoạt động của bạn."
              />

              <div className="space-y-1.5">
                <label htmlFor="account-email" className="block text-sm font-medium theme-text-secondary">Email đăng nhập</label>
                <div className="relative flex items-center">
                  <Mail className="pointer-events-none absolute left-3 h-4 w-4 theme-text-muted" aria-hidden="true" />
                  <input id="account-email" type="email" value={user?.email || ''} readOnly className="theme-control h-10 w-full rounded-md border pl-10 pr-3 text-sm opacity-75" />
                </div>
                <p className="text-xs theme-text-muted">Email này nhận liên kết đặt lại mật khẩu.</p>
              </div>

              {profileError && <p role="alert" className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-surface)] px-3 py-2.5 text-sm text-[var(--status-danger-foreground)]">{profileError}</p>}

              <div className="flex justify-end border-t theme-border pt-4">
                <Button type="submit" className="h-11 px-5" isLoading={isSavingProfile} leftIcon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
                  Lưu thông tin
                </Button>
              </div>
            </form>
          </section>
        ) : (
          <section role="tabpanel" id="account-password-panel" aria-labelledby="account-password-tab">
            <div className="mb-4 rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-surface)] p-4">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info-foreground)]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[var(--status-info-foreground)]">Đặt lại mật khẩu qua email</p>
                  <p className="mt-1 text-sm leading-5 text-[var(--status-info-foreground)]">Firebase sẽ gửi liên kết đặt lại mật khẩu đến <span className="font-medium">{user?.email || 'email tài khoản'}</span>. Bạn mở email, bấm liên kết và đặt mật khẩu mới trên trang bảo mật của Firebase.</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-sm leading-6 theme-text-muted">Gửi email có liên kết dùng một lần. Bạn không cần nhập mật khẩu hiện tại; mật khẩu mới được thiết lập trong trang Firebase.</p>
              <Button type="button" className="h-11 w-full" isLoading={isSendingResetLink} leftIcon={<Mail className="h-4 w-4" aria-hidden="true" />} onClick={() => void handleSendResetLink()}>
                {passwordStatus ? 'Gửi lại liên kết' : 'Gửi liên kết đổi mật khẩu'}
              </Button>
            </div>

            {passwordStatus && <p role="status" className="mt-4 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-surface)] px-3 py-2.5 text-sm text-[var(--status-success-foreground)]">{passwordStatus}</p>}
            {passwordError && <p role="alert" className="mt-4 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-surface)] px-3 py-2.5 text-sm text-[var(--status-danger-foreground)]">{passwordError}</p>}
          </section>
        )}
      </div>
    </Modal>
  );
}

export default AccountSettingsModal;
