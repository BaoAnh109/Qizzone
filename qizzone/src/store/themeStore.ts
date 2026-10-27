import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "qizzone-theme";
const systemThemeQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";

  try {
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedPreference === "light" || storedPreference === "dark" || storedPreference === "system") {
      return storedPreference;
    }
  } catch {
    // Keep the theme usable when browser storage is unavailable.
  }

  return "system";
}

function resolveIsDark(preference: ThemePreference) {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return systemThemeQuery?.matches ?? false;
}

function applyTheme(isDark: boolean) {
  if (typeof document === "undefined") return;

  const theme = isDark ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.backgroundColor = isDark ? "#0E1524" : "#f6f7f9";

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", isDark ? "#0E1524" : "#f6f7f9");
}

interface ThemeState {
  preference: ThemePreference;
  isDark: boolean;
  setPreference: (preference: ThemePreference) => void;
}

const initialPreference = readThemePreference();
const initialIsDark = resolveIsDark(initialPreference);
applyTheme(initialIsDark);

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initialPreference,
  isDark: initialIsDark,
  setPreference: (preference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // The active page still changes theme even if persistence is blocked.
    }

    const isDark = resolveIsDark(preference);
    applyTheme(isDark);
    set({ preference, isDark });
  },
}));

systemThemeQuery?.addEventListener("change", (event) => {
  const currentPreference = useThemeStore.getState().preference;
  if (currentPreference !== "system") return;

  applyTheme(event.matches);
  useThemeStore.setState({ isDark: event.matches });
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;

    const preference: ThemePreference =
      event.newValue === "light" || event.newValue === "dark" || event.newValue === "system"
        ? event.newValue
        : "system";
    const isDark = resolveIsDark(preference);
    applyTheme(isDark);
    useThemeStore.setState({ preference, isDark });
  });
}
