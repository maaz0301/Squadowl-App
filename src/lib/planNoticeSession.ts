/**
 * Whether the "your plan is changing" notice has been dismissed in this login
 * session. Held in memory (survives navigation, not an app restart) and cleared
 * on every login/logout so the next login shows it again.
 */
let dismissedFor: string | null = null;

export function isPlanNoticeDismissed(userId: string | undefined): boolean {
  return !!userId && dismissedFor === userId;
}

export function dismissPlanNotice(userId: string): void {
  dismissedFor = userId;
}

export function resetPlanNotice(): void {
  dismissedFor = null;
}
