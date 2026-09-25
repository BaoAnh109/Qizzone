import { describe, expect, it } from 'vitest';

describe('Router & Room Join Routing Logic', () => {
  it('correctly maps post-login redirection for join links', () => {
    function getPostLoginRedirect(role: string, redirectParam: string | null): string {
      const home = role === 'admin' ? '/admin/teacher-approvals' : role === 'student' ? '/student' : '/teacher';
      if (!redirectParam || redirectParam === '/login' || redirectParam === '/register' || redirectParam === '/unauthorized') {
        return home;
      }
      if (redirectParam.startsWith('/admin') && role !== 'admin') return home;
      if (redirectParam.startsWith('/teacher') && role === 'student') return '/student';
      if (redirectParam.startsWith('/student') && role !== 'student' && !redirectParam.includes('/quiz/')) return home;
      return redirectParam;
    }

    // Direct room join URLs should be preserved regardless of role
    expect(getPostLoginRedirect('student', '/join/ABC123')).toBe('/join/ABC123');
    expect(getPostLoginRedirect('teacher', '/join/ABC123')).toBe('/join/ABC123');
    expect(getPostLoginRedirect('admin', '/join/ABC123')).toBe('/join/ABC123');

    // Default home fallback when no redirect param
    expect(getPostLoginRedirect('student', null)).toBe('/student');
    expect(getPostLoginRedirect('teacher', null)).toBe('/teacher');
    expect(getPostLoginRedirect('admin', null)).toBe('/admin/teacher-approvals');
  });

  it('handles room code normalization for join links', () => {
    const rawCodes = ['abc123', ' ABC123 ', 'qZ9821\n', 'qz9821'];
    const cleaned = rawCodes.map(c => c.trim().toUpperCase());
    expect(cleaned).toEqual(['ABC123', 'ABC123', 'QZ9821', 'QZ9821']);
  });

  it('determines the correct home route for 404 auto-recovery', () => {
    function getNotFoundHome(isAuthenticated: boolean, role?: string): string {
      if (!isAuthenticated || !role) return '/login';
      return role === 'admin'
        ? '/admin/teacher-approvals'
        : role === 'student'
          ? '/student'
          : '/teacher';
    }

    expect(getNotFoundHome(false)).toBe('/login');
    expect(getNotFoundHome(true, 'student')).toBe('/student');
    expect(getNotFoundHome(true, 'teacher')).toBe('/teacher');
    expect(getNotFoundHome(true, 'admin')).toBe('/admin/teacher-approvals');
  });

  it('correctly matches assigned quiz audience by class, email, or public availability', () => {
    function isQuizAvailableForStudent(
      quizSettings: { assignedClasses?: string[]; assignedEmails?: string[] },
      studentClass?: string,
      studentEmail?: string
    ): boolean {
      const assignedClasses = (quizSettings.assignedClasses || []).map(c => c.trim().toLowerCase());
      const assignedEmails = (quizSettings.assignedEmails || []).map(e => e.trim().toLowerCase());

      const hasClassRestriction = assignedClasses.length > 0;
      const hasEmailRestriction = assignedEmails.length > 0;

      // Default: Quizzes without assigned classes or emails do NOT show on student home screen
      if (!hasClassRestriction && !hasEmailRestriction) return false;

      // Matched by email
      if (hasEmailRestriction && studentEmail && assignedEmails.includes(studentEmail.trim().toLowerCase())) {
        return true;
      }

      // Matched by class
      if (hasClassRestriction && studentClass && assignedClasses.includes(studentClass.trim().toLowerCase())) {
        return true;
      }

      return false;
    }

    // Default unassigned quiz: NOT shown on student home screen (join by code/link instead)
    expect(isQuizAvailableForStudent({}, '12A1', 'student@school.edu.vn')).toBe(false);
    expect(isQuizAvailableForStudent({ assignedClasses: [], assignedEmails: [] }, '', '')).toBe(false);

    // Class restricted quiz: shown only if student's class matches
    const classQuiz = { assignedClasses: ['12A1', '12A2'], assignedEmails: [] };
    expect(isQuizAvailableForStudent(classQuiz, '12A1', 'other@gmail.com')).toBe(true);
    expect(isQuizAvailableForStudent(classQuiz, '12a1', 'other@gmail.com')).toBe(true);
    expect(isQuizAvailableForStudent(classQuiz, '10B', 'other@gmail.com')).toBe(false);
    expect(isQuizAvailableForStudent(classQuiz, '', 'other@gmail.com')).toBe(false);

    // Email restricted quiz: shown only if student's email matches
    const emailQuiz = { assignedClasses: [], assignedEmails: ['student1@gmail.com', 'vip@school.edu.vn'] };
    expect(isQuizAvailableForStudent(emailQuiz, '12A1', 'student1@gmail.com')).toBe(true);
    expect(isQuizAvailableForStudent(emailQuiz, '12A1', 'STUDENT1@GMAIL.COM')).toBe(true);
    expect(isQuizAvailableForStudent(emailQuiz, '12A1', 'hacker@gmail.com')).toBe(false);

    // Both class and email assigned (either matches)
    const hybridQuiz = { assignedClasses: ['12A1'], assignedEmails: ['student_external@gmail.com'] };
    expect(isQuizAvailableForStudent(hybridQuiz, '12A1', 'any@gmail.com')).toBe(true);
    expect(isQuizAvailableForStudent(hybridQuiz, '10B', 'student_external@gmail.com')).toBe(true);
    expect(isQuizAvailableForStudent(hybridQuiz, '10B', 'other@gmail.com')).toBe(false);
  });
});
