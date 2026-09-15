import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import type { Tryout } from '@/data/types';
import { useCompleteAssignmentMutation } from '@/features/queries';
import { useIsAssessorOnly } from '@/features/useAssessmentId';
import { usePermissions, useUser } from '@/state/authStore';

/**
 * Complete Assessing — for assessors only, never the owner, a coach/admin or
 * a delegated team manager.
 *
 * `useIsAssessorOnly` alone misses an assessor who is also staff (role
 * 'assessor') on the account that owns the evaluation: `viewerIsOwner` is
 * true for them, so they got no button. The gate is instead "I hold a
 * non-lead assessor row here" plus "I'm not someone who owns or runs it".
 */
export function useCompleteAssessing(tryout: Pick<Tryout, 'id' | 'assessors' | 'viewerIsOwner'> | null | undefined) {
  const navigation = useNavigation<any>();
  const user = useUser();
  const { role } = usePermissions();
  const isAssessorOnly = useIsAssessorOnly(tryout?.viewerIsOwner);
  const completeAssignment = useCompleteAssignmentMutation();
  const [completing, setCompleting] = useState(false);

  const email = user?.email?.toLowerCase();
  const myRow = tryout?.assessors.find(
    (a) => (!!user?.id && a.userId === user.id) || (!!email && a.email?.toLowerCase() === email),
  );
  const canComplete =
    !!tryout &&
    !!myRow &&
    myRow.role !== 'lead' &&
    myRow.status !== 'declined' &&
    myRow.status !== 'completed' &&
    (isAssessorOnly || role === 'assessor');

  /** `beforeComplete` flushes a screen's unsaved scores; a throw there aborts. */
  const complete = (beforeComplete?: () => Promise<void>) => {
    if (!tryout) return;
    Alert.alert(
      'Complete assessing?',
      'This evaluation will be removed from your screen. Your scores are saved and stay with the coach.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            setCompleting(true);
            try {
              await beforeComplete?.();
              await completeAssignment.mutateAsync(tryout.id);
              navigation.navigate('DashboardMain');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not complete this evaluation.');
            } finally {
              setCompleting(false);
            }
          },
        },
      ],
    );
  };

  return { canComplete, completing, complete };
}
