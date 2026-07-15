import { useRoute } from '@react-navigation/native';
import { useSessionStore } from '@/state/sessionStore';

function normalizeParam(value: any): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object' && value.id) return String(value.id);
  return Array.isArray(value) ? String(value[0]) : String(value);
}

/** Resolves assessment id on tab screens where useLocalSearchParams may omit parent [id]. */
export function useAssessmentId(): string | undefined {
  const route = useRoute();
  const id = (route.params as any)?.id;
  const sessionId = useSessionStore((s) => s.currentTryoutId);
  return normalizeParam(id) ?? sessionId ?? undefined;
}
