import { useNavigation, useRoute } from '@react-navigation/native';
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

/**
 * Whether the current screen was reached through the assessor-only entry
 * point (dashboard's "assigned evaluations" list, which navigates in with
 * `isAssessorOnly: true`).
 *
 * Nested navigates to Score / Player / Rinkside often replace AssessmentFlow
 * params and drop the flag — so we also keep `assessorOnlyTryoutId` in the
 * session store for the open assessment.
 */
export function useAssessorMode(): boolean {
  const route = useRoute();
  const navigation = useNavigation();
  const id = useAssessmentId();
  const assessorOnlyTryoutId = useSessionStore((s) => s.assessorOnlyTryoutId);

  if (assessorOnlyTryoutId && id && assessorOnlyTryoutId === id) {
    return true;
  }

  const parentState = navigation.getParent()?.getState();
  const flowRoute = parentState?.routes?.find((r: any) => r.name === 'AssessmentFlow');
  return Boolean(
    (route.params as any)?.isAssessorOnly ||
      (flowRoute?.params as any)?.isAssessorOnly ||
      (flowRoute?.params as any)?.params?.isAssessorOnly ||
      false,
  );
}

/**
 * Whether this viewer gets the assessor's cut of the assessment in front of
 * them, rather than the owner's coach controls.
 *
 * `useAssessorMode()` is a navigation-param hint — right for however this
 * screen was reached, but a delegated team manager who is also an assessor
 * on their own team's assessment would get pinned to the assessor view for
 * the rest of the session on that hint alone. `viewerIsOwner`, computed
 * server-side per tryout from account/team ownership or lead-assessor
 * status, is the real answer and wins the moment it has loaded.
 */
export function useIsAssessorOnly(viewerIsOwner: boolean | undefined): boolean {
  const param = useAssessorMode();
  return viewerIsOwner === undefined ? param : !viewerIsOwner;
}
