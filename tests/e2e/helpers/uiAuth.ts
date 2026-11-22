import { expect, type Page } from '@playwright/test';

export const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

export async function clearBrowserAuth(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

export async function loginViaUi(
  page: Page,
  email: string,
  password: string,
  expectedPathPrefix?: string
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();

  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
  if (expectedPathPrefix) {
    const escaped = expectedPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${escaped}`), { timeout: 20_000 });
  }
}

export async function logoutViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mở tài khoản' }).click();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    metrics.scrollWidth,
    `Horizontal overflow detected: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth} (clientWidth=${metrics.clientWidth}) on ${page.url()}`
  ).toBeLessThanOrEqual(metrics.innerWidth);
}

export async function assertSingleMainLandmark(page: Page): Promise<void> {
  await expect(page.locator('main')).toHaveCount(1);
}

export async function toggleDarkMode(page: Page): Promise<'dark' | 'light'> {
  const compactBtn = page.getByRole('switch', {
    name: /Chuyển sang giao diện (tối|sáng)/,
  });

  if (await compactBtn.isVisible().catch(() => false)) {
    await compactBtn.click();
  } else {
    const profileBtn = page.getByRole('button', { name: 'Mở tài khoản' });
    await profileBtn.click();
    const darkSwitch = page.getByRole('switch', { name: 'Giao diện tối' });
    await darkSwitch.click();
    await profileBtn.click();
  }

  const nextTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  return nextTheme === 'dark' ? 'dark' : 'light';
}

export async function setThemeMode(page: Page, mode: 'light' | 'dark'): Promise<'light' | 'dark'> {
  const current = await page.evaluate(() => document.documentElement.dataset.theme);
  if (current !== mode) {
    await toggleDarkMode(page);
  }
  const finalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(finalTheme).toBe(mode);
  return finalTheme === 'dark' ? 'dark' : 'light';
}

export async function confirmActionDialog(
  page: Page,
  action: 'confirm' | 'cancel',
  confirmButtonPattern: RegExp = /Xác nhận|Đồng ý|Khóa|Mở khóa|Từ chối|Phê duyệt|Xóa|Lưu/i
): Promise<void> {
  let nativeHandled = false;
  const nativeHandler = async (dialog: import('@playwright/test').Dialog) => {
    nativeHandled = true;
    if (action === 'confirm') {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  };
  page.once('dialog', nativeHandler);

  try {
    const modal = page.getByRole('dialog').last();
    await modal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    if (!nativeHandled && (await modal.isVisible().catch(() => false))) {
      if (action === 'confirm') {
        await modal.getByRole('button', { name: confirmButtonPattern }).first().click();
      } else {
        await modal
          .getByRole('button', { name: /Hủy|Đóng|Để sau|Không/i })
          .first()
          .click();
      }
    }
  } finally {
    page.off('dialog', nativeHandler);
  }
}

export async function clickAndHandleNativeConfirm(
  page: Page,
  action: 'confirm' | 'cancel',
  click: () => Promise<unknown>,
): Promise<void> {
  const dialogPromise = page.waitForEvent('dialog', { timeout: 5_000 });
  const clickPromise = click();
  void clickPromise.catch(() => undefined);
  let dialog: import('@playwright/test').Dialog;
  try {
    dialog = await dialogPromise;
  } catch (error) {
    await clickPromise.catch(() => undefined);
    throw error;
  }

  if (action === 'confirm') await dialog.accept();
  else await dialog.dismiss();
  await clickPromise;
}

export async function expectToast(page: Page, pattern: RegExp): Promise<void> {
  await expect(page.getByText(pattern).first()).toBeVisible({ timeout: 15_000 });
}
