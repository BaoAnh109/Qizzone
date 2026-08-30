import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { User, LoginCredentials, RegisterData } from "@/types/auth";
import { mockAuthService } from "@/services/mockAuthService";

interface AuthStoreState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (credentials: LoginCredentials) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<User>;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true });
        try {
          const response = await mockAuthService.login(credentials);
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
          return response.user;
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (data: RegisterData) => {
        set({ isLoading: true });
        try {
          const response = await mockAuthService.register(data);
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
          return response.user;
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      setAuth: (user: User, token: string) => {
        set({
          user,
          token,
          isAuthenticated: true,
          isLoading: false,
        });
      },

      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
        });
      },

      updateProfile: async (data: Partial<User>) => {
        const currentUser = get().user;
        if (!currentUser) throw new Error("Chưa đăng nhập");

        set({ isLoading: true });
        try {
          const updated = await mockAuthService.updateProfile(currentUser.id, data);
          set({ user: updated, isLoading: false });
          return updated;
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      clearAuth: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
        });
      },
    }),
    {
      name: "qizzone_auth_session",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

export default useAuthStore;