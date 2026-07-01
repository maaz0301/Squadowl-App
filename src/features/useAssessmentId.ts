import { useRoute } from '@react-navigation/native';
import { useSessionStore } from '@/state/sessionStore';

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Resolves assessment id on tab screens where useLocalSearchParams may omit parent [id]. */
export function useAssessmentId(): string | undefined {
  const route = useRoute();
  const id = (route.params as any)?.id;
  const sessionId = useSessionStore((s) => s.currentTryoutId);
  return normalizeParam(id) ?? sessionId ?? undefined;
}
