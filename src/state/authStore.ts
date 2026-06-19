import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthSession, UserProfile } from '@/data/types';
import { getDataSource } from '@/data';
import { zustandStorage } from '@/lib/storage';

interface AuthState {
  session: AuthSession | null;
  isHydrated: boolean;
  setSession: (session: AuthSession | null) => void;
  setHydrated: (v: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (displayName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      isHydrated: false,
      setSession: (session) => set({ session }),
      setHydrated: (v) => set({ isHydrated: v }),
      login: async (email, password) => {
        const session = await getDataSource().login(email, password);
        set({ session });
      },
      signup: async (displayName, email, password) => {
        const session = await getDataSource().signup(displayName, email, password);
        set({ session });
      },
      logout: async () => {
        await getDataSource().logout();
        set({ session: null });
      },
      restoreSession: async () => {
        const session = await getDataSource().getSession();
        set({ session, isHydrated: true });
      },
      updateProfile: async (updates) => {
        const profile = await getDataSource().updateProfile(updates);
        const session = get().session;
        if (session) set({ session: { ...session, user: profile } });
      },
    }),
    {
      name: 'aas-auth-store',
      storage: zustandStorage,
      partialize: (s) => ({ session: s.session }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export function useUser(): UserProfile | null {
  return useAuthStore((s) => s.session?.user ?? null);
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => !!s.session);
}
