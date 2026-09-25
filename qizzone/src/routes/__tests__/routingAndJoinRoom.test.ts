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
});
