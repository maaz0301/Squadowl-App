import { useGlobalSearchParams } from 'expo-router';
import { useSessionStore } from '@/state/sessionStore';

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Resolves assessment id on tab screens where useLocalSearchParams may omit parent [id]. */
export function useAssessmentId(): string | undefined {
  const { id } = useGlobalSearchParams<{ id?: string | string[] }>();
  const sessionId = useSessionStore((s) => s.currentTryoutId);
  return normalizeParam(id) ?? sessionId ?? undefined;
}
