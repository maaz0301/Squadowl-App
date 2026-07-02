import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryKeys = {
  session: ['session'] as const,
  profile: ['profile'] as const,
  teams: ['teams'] as const,
  tryouts: (archived?: boolean) => ['tryouts', { archived }] as const,
  assignedTryouts: ['tryouts', 'assigned'] as const,
  tryout: (id: string) => ['tryout', id] as const,
  registrations: (tryoutId: string) => ['registrations', tryoutId] as const,
  results: (tryoutId: string) => ['results', tryoutId] as const,
  seasons: ['seasons'] as const,
  season: (id: string) => ['season', id] as const,
  org: ['org'] as const,
  orgMembers: ['org', 'members'] as const,
  enterprisePayments: ['enterprise', 'payments'] as const,
  adminStats: ['admin', 'stats'] as const,
  adminUsers: ['admin', 'users'] as const,
  aiPlayer: (tryoutId: string, playerId: string) => ['ai', 'player', tryoutId, playerId] as const,
  guardianRosters: ['guardian', 'rosters'] as const,
};
