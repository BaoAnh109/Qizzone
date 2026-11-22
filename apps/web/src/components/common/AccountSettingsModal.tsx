import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Camera,
  Check,
  Clock3,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { changePasswordSchema } from '@/lib/validations/auth';
import {
  confirmPasswordChange,
  requestPasswordChangeOtp,
  uploadAccountAvatar,
} from '@/services/accountSettingsService';
import { useAuthStore } from '@/store/authStore';

type SettingsTab = 'profile' | 'password';
type PasswordStep = 'form' | 'otp';

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function AccountSettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const user = useAuthStore(state => state.user);
  const updateProfile = useAuthStore(state => state.updateProfile);

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [fullName, setFullName] = useState(() => user?.fullName || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [passwordStep, setPasswordStep] = useState<PasswordStep>('form');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpExpiresAtMs, setOtpExpiresAtMs] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isConfirmingChange, setIsConfirmingChange] = useState(false);

  useEffect(() => {
    if (!previewUrl?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!otpExpiresAtMs || passwordStep !== 'otp') return;
    const syncRemaining = () => {
      const next = Math.max(0, Math.ceil((otpExpiresAtMs - Date.now()) / 1000));
      setRemainingSeconds(next);
    };
    syncRemaining();
    const timer = window.setInterval(syncRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [otpExpiresAtMs, passwordStep]);

  const isBusy = isSavingProfile || isRequestingOtp || isConfirmingChange;
  const isGoogleOnly = user?.hasPassword === false;
  const avatarSrc = previewUrl || user?.avatarUrl;
  const avatarInitial = fullName.trim().charAt(0).toUpperCase() || 'Q';

  const passwordChecks = [
    { label: 'Ít nhất 8 ký tự', passed: newPassword.length >= 8 },
    { label: 'Có chữ hoa (A–Z)', passed: /[A-Z]/.test(newPassword) },
    { label: 'Có số (0–9)', passed: /\d/.test(newPassword) },
    { label: 'Có ký tự đặc biệt', passed: /[\p{P}\p{S}]/u.test(newPassword) },
  ];
  const passwordScore = passwordChecks.filter(check => check.passed).length;
  const strengthBarColor = passwordScore === 4
    ? 'bg-status-success'
    : passwordScore === 3
      ? 'bg-status-warning'
      : passwordScore > 0
        ? 'bg-status-danger'
        : 'theme-surface-inset';

  const resetPasswordState = () => {
    setPasswordStep('form');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setOtpCode('');
    setOtpExpiresAtMs(null);
    setRemainingSeconds(0);
    setResendCooldown(0);
    setPasswordError(null);
  };

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

  const requestOtpForPasswordChange = async () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message || 'Thông tin mật khẩu không hợp lệ.');
      return;
    }

    setIsRequestingOtp(true);
    setPasswordError(null);
    try {
      const res = await requestPasswordChangeOtp(parsed.data);
      const parsedExpiry = Date.parse(res.expiresAt);
      const expiresAtMs = Number.isFinite(parsedExpiry)
        ? parsedExpiry
        : Date.now() + (res.expiresInSeconds || 900) * 1000;
      setOtpExpiresAtMs(expiresAtMs);
      setRemainingSeconds(Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000)));
      setResendCooldown(res.cooldownSeconds || 60);
      setOtpCode('');
      setPasswordStep('otp');
      toast.success(`Mã OTP có hiệu lực 15 phút đã được gửi tới ${user?.email}.`, 'Kiểm tra hộp thư');
    } catch (error) {
      const message = formatError(error, 'Không thể gửi mã OTP đổi mật khẩu.');
      setPasswordError(message);
      toast.error(message, 'Không thể gửi OTP');
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleRequestOtpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void requestOtpForPasswordChange();
  };

  const handleConfirmChangeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setPasswordError('Vui lòng nhập đủ mã OTP gồm 6 chữ số.');
      return;
    }
    if (remainingSeconds <= 0) {
      setPasswordError('Mã OTP đã hết hạn (quá 15 phút). Vui lòng gửi mã mới.');
      return;
    }

    setIsConfirmingChange(true);
    setPasswordError(null);
    try {
      await confirmPasswordChange({
        currentPassword,
        newPassword,
        confirmPassword,
        otp: otpCode.trim(),
      });
      toast.success('Mật khẩu của bạn đã được cập nhật.', 'Đổi mật khẩu thành công');
      resetPasswordState();
      onClose();
    } catch (error) {
      const message = formatError(error, 'Xác nhận đổi mật khẩu thất bại.');
      setPasswordError(message);
      toast.error(message, 'Đổi mật khẩu thất bại');
    } finally {
      setIsConfirmingChange(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (isBusy) return;
        resetPasswordState();
        onClose();
      }}
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
            className={`flex h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 sm:gap-2 sm:px-3 sm:text-sm ${activeTab === 'profile' ? 'theme-surface-raised theme-text-primary shadow-sm' : 'theme-text-muted theme-hover-text-primary'}`}
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
            className={`flex h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 sm:gap-2 sm:px-3 sm:text-sm ${activeTab === 'password' ? 'theme-surface-raised theme-text-primary shadow-sm' : 'theme-text-muted theme-hover-text-primary'}`}
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
                  <label htmlFor="account-avatar-file" className={`mt-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border theme-border theme-surface-raised px-3 text-sm font-medium theme-text-secondary transition theme-hover-surface peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 ${isSavingProfile ? 'pointer-events-none opacity-50' : ''}`}>
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
                <p className="text-xs theme-text-muted">Email này dùng để đăng nhập và nhận mã OTP xác thực.</p>
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
            {isGoogleOnly ? (
              <div className="rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-surface)] p-4">
                <div className="flex gap-3">
                  <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info-foreground)]" aria-hidden="true" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-[var(--status-info-foreground)]">
                      Tài khoản được liên kết Google
                    </p>
                    <p className="text-sm leading-5 text-[var(--status-info-foreground)]">
                      Tài khoản này được liên kết với Google và không có mật khẩu trên Qizzone. Vui lòng quản lý mật khẩu và bảo mật trực tiếp tại tài khoản Google của bạn.
                    </p>
                  </div>
                </div>
              </div>
            ) : passwordStep === 'form' ? (
              <form onSubmit={handleRequestOtpSubmit} className="space-y-4">
                <Input
                  id="change-current-password"
                  label="Mật khẩu hiện tại"
                  type={showCurrentPassword ? 'text' : 'password'}
                  placeholder="Nhập mật khẩu hiện tại"
                  autoComplete="current-password"
                  leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
                  rightIcon={(
                    <button
                      type="button"
                      aria-label={showCurrentPassword ? 'Ẩn mật khẩu hiện tại' : 'Hiện mật khẩu hiện tại'}
                      onClick={() => setShowCurrentPassword(v => !v)}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md theme-text-muted transition theme-hover-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  )}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                />

                <div className="space-y-2">
                  <Input
                    id="change-new-password"
                    label="Mật khẩu mới"
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="Tối thiểu 8 ký tự, chữ hoa, số, ký tự đặc biệt"
                    autoComplete="new-password"
                    leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
                    rightIcon={(
                      <button
                        type="button"
                        aria-label={showNewPassword ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                        onClick={() => setShowNewPassword(v => !v)}
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md theme-text-muted transition theme-hover-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    )}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                  />
                  <div className="space-y-2 text-xs">
                    <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
                      {passwordChecks.map((check, index) => (
                        <span
                          key={check.label}
                          className={`h-1.5 rounded-full transition-colors ${index < passwordScore ? strengthBarColor : 'theme-surface-inset'}`}
                        />
                      ))}
                    </div>
                    <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {passwordChecks.map(({ label, passed }) => (
                        <li key={label} className={`flex items-center gap-1.5 ${passed ? 'text-status-success' : 'theme-text-muted'}`}>
                          {passed ? (
                            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                          )}
                          <span>{label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <Input
                  id="change-confirm-password"
                  label="Xác nhận mật khẩu mới"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Nhập lại mật khẩu mới"
                  autoComplete="new-password"
                  leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
                  rightIcon={(
                    <button
                      type="button"
                      aria-label={showConfirmPassword ? 'Ẩn xác nhận mật khẩu mới' : 'Hiện xác nhận mật khẩu mới'}
                      onClick={() => setShowConfirmPassword(v => !v)}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md theme-text-muted transition theme-hover-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  )}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />

                {passwordError && (
                  <p role="alert" className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-surface)] px-3 py-2.5 text-sm text-[var(--status-danger-foreground)]">
                    {passwordError}
                  </p>
                )}

                <div className="border-t theme-border pt-4">
                  <Button
                    type="submit"
                    className="h-11 w-full"
                    isLoading={isRequestingOtp}
                    leftIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
                  >
                    Gửi mã OTP xác thực
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={event => void handleConfirmChangeSubmit(event)} className="space-y-4">
                <div className="rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-surface)] p-4">
                  <div className="flex gap-3">
                    <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info-foreground)]" aria-hidden="true" />
                    <div className="space-y-1 text-sm text-[var(--status-info-foreground)]">
                      <p className="font-semibold">Xác thực OTP qua email</p>
                      <p>
                        Mã OTP 6 chữ số đã được gửi tới <span className="font-medium">{user?.email}</span>.
                        {' '}
                        {remainingSeconds > 0 ? (
                          <span>Mã hết hạn sau <strong>{formatCountdown(remainingSeconds)}</strong> (15 phút).</span>
                        ) : (
                          <span className="font-semibold">Mã OTP đã hết hạn (quá 15 phút).</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <Input
                  id="change-password-otp"
                  label="Mã xác thực OTP"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Nhập mã 6 chữ số"
                  leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />

                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="min-h-8 text-xs"
                    disabled={isBusy}
                    onClick={() => {
                      setPasswordStep('form');
                      setOtpCode('');
                      setPasswordError(null);
                    }}
                  >
                    Quay lại sửa mật khẩu
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="min-h-8 text-xs"
                    disabled={resendCooldown > 0 || isRequestingOtp || isConfirmingChange}
                    onClick={() => void requestOtpForPasswordChange()}
                  >
                    {resendCooldown > 0 ? `Gửi lại (${resendCooldown}s)` : 'Gửi lại mã OTP'}
                  </Button>
                </div>

                {passwordError && (
                  <p role="alert" className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-surface)] px-3 py-2.5 text-sm text-[var(--status-danger-foreground)]">
                    {passwordError}
                  </p>
                )}

                <div className="border-t theme-border pt-4">
                  <Button
                    type="submit"
                    className="h-11 w-full"
                    isLoading={isConfirmingChange}
                    disabled={!/^\d{6}$/.test(otpCode.trim()) || remainingSeconds <= 0}
                    leftIcon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                  >
                    Xác nhận đổi mật khẩu
                  </Button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

export default AccountSettingsModal;
