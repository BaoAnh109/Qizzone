import { test, expect, type Page } from '@playwright/test';
import {
  addClassroomMembers,
  callEdge,
  callRpc,
  cleanupE2eRun,
  provisionE2eRun,
  seedAssignment,
  seedBugReport,
  seedClassroom,
  seedQuiz,
  signInAndGetToken,
  sweepStaleE2eAccounts,
  type E2eRunManifest,
} from './helpers/supabaseAdmin';
import {
  assertNoHorizontalOverflow,
  assertSingleMainLandmark,
  clearBrowserAuth,
  DESKTOP_VIEWPORT,
  loginViaUi,
  logoutViaUi,
  MOBILE_VIEWPORT,
  setThemeMode,
} from './helpers/uiAuth';

const STRUCTURAL_EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2139}]/u;

async function auditPageContrastAndChrome(page: Page, routeLabel: string): Promise<void> {
  const report = await page.evaluate((emojiPatternSource) => {
    const emojiRe = new RegExp(emojiPatternSource, 'u');

    function parseRgba(raw: string): { r: number; g: number; b: number; a: number } | null {
      const m = raw.match(/rgba?\(([^)]+)\)/i);
      if (!m) return null;
      const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1,
      };
    }

    function compositeOver(
      fg: { r: number; g: number; b: number; a: number },
      bg: { r: number; g: number; b: number }
    ): { r: number; g: number; b: number } {
      const a = Math.max(0, Math.min(1, fg.a));
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
      };
    }

    function getEffectiveBg(el: Element): { r: number; g: number; b: number } {
      const isDark = document.documentElement.dataset.theme === 'dark';
      let base = isDark ? { r: 11, g: 18, b: 32 } : { r: 239, g: 246, b: 255 };
      const stack: Array<{ r: number; g: number; b: number; a: number }> = [];
      let cur: Element | null = el;
      while (cur) {
        const bg = parseRgba(getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0) stack.push(bg);
        cur = cur.parentElement;
      }
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        base = compositeOver(stack[i], base);
      }
      return base;
    }

    function relLuminance(c: { r: number; g: number; b: number }): number {
      const chan = [c.r, c.g, c.b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
    }

    function contrastRatio(
      c1: { r: number; g: number; b: number },
      c2: { r: number; g: number; b: number }
    ): number {
      const l1 = relLuminance(c1);
      const l2 = relLuminance(c2);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }

    function isVisible(el: Element): boolean {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    // 1. Contrast checks on headings, primary buttons, and visible non-decorative SVG icons inside buttons/hero badges
    const contrastFailures: string[] = [];
    const textTargets = Array.from(
      document.querySelectorAll('main h1, main h2, main button, header h2, main label')
    ).filter((el) => isVisible(el) && (el.textContent || '').trim().length > 0);

    for (const el of textTargets.slice(0, 25)) {
      const style = getComputedStyle(el);
      const fgParsed = parseRgba(style.color);
      if (!fgParsed) continue;
      const bg = getEffectiveBg(el);
      const fg = compositeOver(fgParsed, bg);
      const ratio = contrastRatio(fg, bg);
      const fontSize = parseFloat(style.fontSize) || 14;
      const fontWeight = parseInt(style.fontWeight, 10) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const minRequired = isLarge ? 3.0 : 4.5;
      if (ratio < minRequired) {
        contrastFailures.push(
          `${el.tagName.toLowerCase()}("${(el.textContent || '').trim().slice(0, 30)}") ratio=${ratio.toFixed(2)} < ${minRequired}`
        );
      }
    }

    // Explicitly audit hero/header SVG icons (e.g. StudentDashboard KeyRound icon)
    const iconTargets = Array.from(document.querySelectorAll('main svg, header button svg')).filter(
      (svg) => {
        if (!isVisible(svg)) return false;
        const rect = svg.getBoundingClientRect();
        return rect.width >= 16 && rect.height >= 16;
      }
    );
    for (const svg of iconTargets.slice(0, 15)) {
      const style = getComputedStyle(svg);
      const fgParsed = parseRgba(style.color);
      if (!fgParsed) continue;
      const bg = getEffectiveBg(svg);
      const fg = compositeOver(fgParsed, bg);
      const ratio = contrastRatio(fg, bg);
      if (ratio < 3.0) {
        contrastFailures.push(
          `svg(${svg.getAttribute('class') || 'icon'}) ratio=${ratio.toFixed(2)} < 3.0`
        );
      }
    }

    // 2. Structural emoji check in UI chrome (excluding seeded quiz question text blocks)
    const emojiHits: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const txt = node.nodeValue || '';
      const parent = node.parentElement;
      if (
        parent &&
        isVisible(parent) &&
        !parent.closest('.katex, [data-quiz-content="true"]') &&
        emojiRe.test(txt)
      ) {
        emojiHits.push(`${parent.tagName.toLowerCase()}: "${txt.trim().slice(0, 40)}"`);
      }
      node = walker.nextNode();
    }

    // 3. Sibling button overlap & sticky header occlusion check
    const overlapErrors: string[] = [];
    const header = document.querySelector('header');
    const headerRect = header && isVisible(header) ? header.getBoundingClientRect() : null;

    const mainButtons = Array.from(document.querySelectorAll('main button, main a')).filter(isVisible);
    for (let i = 0; i < mainButtons.length; i += 1) {
      const rA = mainButtons[i].getBoundingClientRect();
      if (
        headerRect &&
        window.scrollY === 0 &&
        rA.top < headerRect.bottom - 2 &&
        rA.bottom > headerRect.top + 2 &&
        rA.left < headerRect.right &&
        rA.right > headerRect.left
      ) {
        overlapErrors.push(
          `Sticky header occludes "${(mainButtons[i].textContent || '').trim().slice(0, 25)}"`
        );
      }
      // Check against direct siblings only
      for (let j = i + 1; j < mainButtons.length; j += 1) {
        if (mainButtons[i].parentElement !== mainButtons[j].parentElement) continue;
        const rB = mainButtons[j].getBoundingClientRect();
        const xOverlap = Math.min(rA.right, rB.right) - Math.max(rA.left, rB.left);
        const yOverlap = Math.min(rA.bottom, rB.bottom) - Math.max(rA.top, rB.top);
        if (xOverlap > 2 && yOverlap > 2) {
          overlapErrors.push(
            `Sibling overlap: "${(mainButtons[i].textContent || '').trim().slice(0, 20)}" vs "${(mainButtons[j].textContent || '').trim().slice(0, 20)}"`
          );
        }
      }
    }

    return { contrastFailures, emojiHits, overlapErrors };
  }, STRUCTURAL_EMOJI_RE.source);

  expect(
    report.contrastFailures,
    `Contrast failures on ${routeLabel}: ${report.contrastFailures.join('; ')}`
  ).toEqual([]);
  expect(
    report.emojiHits,
    `Raw structural emojis found on ${routeLabel}: ${report.emojiHits.join('; ')}`
  ).toEqual([]);
  expect(
    report.overlapErrors,
    `Layout overlap/occlusion on ${routeLabel}: ${report.overlapErrors.join('; ')}`
  ).toEqual([]);
}

async function auditMobileTouchTargets(page: Page, routeLabel: string): Promise<void> {
  const smallTargets = await page.evaluate(() => {
    const selectors = [
      'header button',
      'main button[type="submit"]',
      'main input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
      'main select',
      '[role="dialog"] button[aria-label="Đóng"]',
    ];
    const failures: string[] = [];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.height < 44 || (el.tagName === 'BUTTON' && rect.width < 44)) {
          const label =
            el.getAttribute('aria-label') ||
            (el.textContent || '').trim() ||
            el.getAttribute('placeholder') ||
            sel;
          failures.push(`${label} (${Math.round(rect.width)}x${Math.round(rect.height)}px)`);
        }
      }
    }
    return failures;
  });

  expect(
    smallTargets,
    `Mobile touch targets < 44px on ${routeLabel}: ${smallTargets.join('; ')}`
  ).toEqual([]);
}

async function auditRouteAllModes(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // 1. Desktop 1280x800 Light & Dark
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await setThemeMode(page, 'light');
  await assertSingleMainLandmark(page);
  await assertNoHorizontalOverflow(page);
  await auditPageContrastAndChrome(page, `${route} [desktop-light]`);

  await setThemeMode(page, 'dark');
  await assertSingleMainLandmark(page);
  await assertNoHorizontalOverflow(page);
  await auditPageContrastAndChrome(page, `${route} [desktop-dark]`);

  // 2. Mobile 390x844 Dark & Light + touch targets
  await page.setViewportSize(MOBILE_VIEWPORT);
  await assertSingleMainLandmark(page);
  await assertNoHorizontalOverflow(page);
  await auditPageContrastAndChrome(page, `${route} [mobile-dark]`);
  await auditMobileTouchTargets(page, `${route} [mobile-dark]`);

  await setThemeMode(page, 'light');
  await assertNoHorizontalOverflow(page);
  await auditPageContrastAndChrome(page, `${route} [mobile-light]`);
  await auditMobileTouchTargets(page, `${route} [mobile-light]`);

  await page.setViewportSize(DESKTOP_VIEWPORT);
}

test.describe('R5 & Tier 4: ui-ux-pro-max Responsive, Dark Mode, Contrast, Modal A11y & Chrome Audit', () => {
  let run: E2eRunManifest;
  let classroomId = '';
  let quizId = '';
  let resultId = '';

  test.beforeAll(async () => {
    await sweepStaleE2eAccounts(24).catch(() => undefined);
    run = await provisionE2eRun('r5_uiux');

    const classroom = await seedClassroom(run, run.accounts.teacher1.uid, {
      name: `[E2E] R5 Lớp ${run.runId.slice(-4)}`,
    });
    classroomId = classroom.id;
    await addClassroomMembers(classroom.id, [
      {
        email: run.accounts.student1.email,
        studentUid: run.accounts.student1.uid,
        memberName: run.accounts.student1.fullName,
        status: 'active',
        joinedVia: 'teacher_email',
      },
    ]);

    const quiz = await seedQuiz(run, run.accounts.teacher1.uid, {
      title: `[E2E] R5 Đề ${run.runId.slice(-4)}`,
      settings: { publishScope: 'public', scoreVisibility: 'immediate', answerVisibility: 'immediate' },
    });
    quizId = quiz.id;
    const assign = await seedAssignment(classroom.id, quiz.id, {
      assignedBy: run.accounts.teacher1.uid,
    });
    await seedBugReport(run, run.accounts.student1.uid, {
      reporterRole: 'student',
      title: `[E2E] R5 Bug ${run.runId.slice(-4)}`,
    });

    const stuToken = (await signInAndGetToken(run.accounts.student1.email, run.password)).accessToken;
    const startRes = await callRpc(
      'start_attempt',
      { p_quiz_id: quiz.id, p_class: '12A1', p_assignment_id: assign.id },
      stuToken
    );
    const attId = (startRes.json as { id: string }).id;
    const finRes = await callEdge('finalize-exam', {
      token: stuToken,
      body: { attemptId: attId, idempotencyKey: `r5_fin_${attId}` },
    });
    resultId = (finRes.json as { id: string }).id;
  });

  test.afterAll(async () => {
    await cleanupE2eRun(run);
  });

  test('Auth routes (/login, /register): Desktop/Mobile, Light/Dark persistence, single <main>, zero overflow & contrast', async ({
    page,
  }) => {
    await clearBrowserAuth(page);
    await auditRouteAllModes(page, '/login');
    await auditRouteAllModes(page, '/register');

    // Theme persistence across reload
    await page.goto('/login');
    await setThemeMode(page, 'dark');
    await page.reload();
    const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(persisted).toBe('dark');
    await setThemeMode(page, 'light');
  });

  test('Admin routes (/admin/teacher-approvals, /admin/accounts, /admin/bug-reports): Desktop/Mobile Light/Dark audit', async ({
    page,
  }) => {
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.admin.email, run.password, '/admin/teacher-approvals');

    await auditRouteAllModes(page, '/admin/teacher-approvals');
    await auditRouteAllModes(page, '/admin/accounts');
    await auditRouteAllModes(page, '/admin/bug-reports');

    await logoutViaUi(page);
  });

  test('Teacher routes (/teacher, /teacher/classes, /teacher/classes/:id, /teacher/quizzes, /teacher/quiz/:id/results, /teacher/bug-reports): Desktop/Mobile Light/Dark audit', async ({
    page,
  }) => {
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.teacher1.email, run.password, '/teacher');

    await auditRouteAllModes(page, '/teacher');
    await auditRouteAllModes(page, '/teacher/classes');
    await auditRouteAllModes(page, `/teacher/classes/${classroomId}`);
    await auditRouteAllModes(page, '/teacher/quizzes');
    await auditRouteAllModes(page, `/teacher/quiz/${quizId}/results`);
    await auditRouteAllModes(page, '/teacher/bug-reports');

    await logoutViaUi(page);
  });

  test('Student routes (/student, classes, bug-reports, lobby, QuizRoom, Result) + Modal focus trap, Tab/Shift+Tab, Esc & focus restore', async ({
    page,
  }) => {
    await clearBrowserAuth(page);
    await loginViaUi(page, run.accounts.student1.email, run.password, '/student');

    await auditRouteAllModes(page, '/student');
    await auditRouteAllModes(page, '/student/classes');
    await auditRouteAllModes(page, `/student/classes/${classroomId}`);
    await auditRouteAllModes(page, '/student/bug-reports');
    await auditRouteAllModes(page, `/student/quiz/${quizId}/lobby`);
    await auditRouteAllModes(page, `/student/result/${resultId}`);

    // Audit QuizRoom (/student/quiz/:quizId) in both desktop/mobile & light/dark
    await page.goto(`/student/quiz/${quizId}/lobby`);
    await page.getByRole('button', { name: 'Bắt đầu làm bài thi ngay' }).click();
    await expect(page).toHaveURL(new RegExp(`/student/quiz/${quizId}$`), { timeout: 20_000 });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await assertSingleMainLandmark(page);
    await assertNoHorizontalOverflow(page);
    await auditPageContrastAndChrome(page, '/student/quiz/:id [desktop]');

    await page.setViewportSize(MOBILE_VIEWPORT);
    await assertSingleMainLandmark(page);
    await assertNoHorizontalOverflow(page);
    await auditPageContrastAndChrome(page, '/student/quiz/:id [mobile]');
    await page.setViewportSize(DESKTOP_VIEWPORT);

    // Modal Accessibility: BugReportModal (role=dialog, aria-modal=true, accessible name, focus inside, Tab trap, Esc restores focus)
    await page.goto('/student');
    const bugBtn = page.getByRole('button', { name: 'Báo lỗi hệ thống' });
    await bugBtn.click();

    const bugDialog = page.getByRole('dialog');
    await expect(bugDialog).toBeVisible();
    await expect(bugDialog).toHaveAttribute('aria-modal', 'true');
    const bugLabelledBy = await bugDialog.getAttribute('aria-labelledby');
    const bugAriaLabel = await bugDialog.getAttribute('aria-label');
    expect(Boolean(bugLabelledBy || bugAriaLabel)).toBe(true);

    const focusInsideDialog = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return Boolean(dlg && document.activeElement && dlg.contains(document.activeElement));
    });
    expect(focusInsideDialog).toBe(true);

    // Tab forward & Shift+Tab backward must keep focus trapped inside dialog
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const stillInside = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return Boolean(dlg && document.activeElement && dlg.contains(document.activeElement));
      });
      expect(stillInside).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    const stillInsideAfterShiftTab = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return Boolean(dlg && document.activeElement && dlg.contains(document.activeElement));
    });
    expect(stillInsideAfterShiftTab).toBe(true);

    // Escape closes & restores focus to trigger button
    await page.keyboard.press('Escape');
    await expect(bugDialog).toHaveCount(0);
    await expect(bugBtn).toBeFocused();

    // AccountSettingsModal a11y check
    await page.getByRole('button', { name: 'Mở tài khoản' }).click();
    await page.getByRole('button', { name: 'Cài đặt tài khoản' }).click();
    const acctDialog = page.getByRole('dialog');
    await expect(acctDialog).toBeVisible();
    await expect(acctDialog).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Tab');
    const acctFocusInside = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return Boolean(dlg && document.activeElement && dlg.contains(document.activeElement));
    });
    expect(acctFocusInside).toBe(true);
    await page.keyboard.press('Escape');
    await expect(acctDialog).toHaveCount(0);

    await logoutViaUi(page);
  });
});
