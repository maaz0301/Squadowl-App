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
        try {
          const session = await getDataSource().getSession();
          set({ session, isHydrated: true });
        } catch (e) {
          console.error('Failed to restore session:', e);
          set({ session: null, isHydrated: true });
        }
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

import { useOrgMembersQuery } from '@/features/queries';

export function usePermissions() {
  const user = useUser();
  const { data: members = [] } = useOrgMembersQuery();
  
  // For demo: if they are the primary coach@example.com account, default to admin if not found.
  // In production, everyone must be an org member.
  const isDemoAdmin = user?.email.toLowerCase() === 'coach@example.com';
  
  const myMember = members.find(
    (m) => m.email.toLowerCase() === user?.email.toLowerCase() && m.status === 'active'
  );

  const role = myMember?.role ?? (isDemoAdmin ? 'admin' : 'guardian');

  return {
    role,
    canManageOrganization: role === 'admin',
    canManageTeam: role === 'admin' || role === 'coach',
    canCreateAssessments: role === 'admin' || role === 'coach',
    canAssess: role === 'admin' || role === 'coach' || role === 'assessor',
    isGuardian: role === 'guardian',
  };
}
