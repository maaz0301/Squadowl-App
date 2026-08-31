import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Button, Chip, Modal } from '@/components/ui';
import { useTeamsQuery, useTryoutSummariesQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

export type RosterDestination =
  | { kind: 'assessment'; id: string; name: string }
  | { kind: 'team'; id: string; name: string };

interface AddToRosterModalProps {
  visible: boolean;
  /** How many registrations this will place — drives the confirm label. */
  count: number;
  /** The assessment the registrations came from, so it can be marked as current. */
  currentTryoutId?: string;
  loading?: boolean;
  /** How many of the selected registrations have been placed so far — only
   * meaningful once `loading` is true and there's more than one to add. */
  progress?: { done: number; total: number };
  onClose: () => void;
  onConfirm: (destination: RosterDestination) => void;
}

type Kind = 'assessment' | 'team';

/**
 * Destination picker for pending registrations. The list of targets stays hidden
 * until a kind is picked — choosing "Assessment" or "Team" is what reveals the
 * assessments or teams available to receive the players.
 */
export function AddToRosterModal({
  visible,
  count,
  currentTryoutId,
  loading,
  progress,
  onClose,
  onConfirm,
}: AddToRosterModalProps) {
  const colors = useThemeColors();
  const [kind, setKind] = useState<Kind | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  // Name plus a headcount hint — see useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery();
  const teamsQuery = useTeamsQuery();

  // Reopening always starts at the kind choice rather than resurfacing whatever
  // was picked last time, so nothing can be confirmed without being re-seen.
  useEffect(() => {
    if (visible) {
      setKind(null);
      setTargetId(null);
    }
  }, [visible]);

  const options =
    kind === 'assessment'
      ? (tryoutsQuery.data ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          hint: t.id === currentTryoutId ? 'Current' : `${t.playerCount} players`,
        }))
      : kind === 'team'
        ? (teamsQuery.data ?? []).map((t) => ({ id: t.id, name: t.name, hint: t.season ?? '' }))
        : [];

  const listLoading = kind === 'assessment' ? tryoutsQuery.isLoading : teamsQuery.isLoading;
  const selected = options.find((o) => o.id === targetId);

  return (
    <Modal
      visible={visible}
      title={count > 1 ? `Add ${count} Players` : 'Add Player'}
      onClose={onClose}
      footer={
        <View className="mt-4 gap-2">
          {loading && progress && progress.total > 0 ? (
            <View style={{ gap: 4 }}>
              <View
                style={{
                  width: '100%',
                  height: 8,
                  borderRadius: 999,
                  overflow: 'hidden',
                  backgroundColor: colors.tile,
                }}
              >
                <View
                  style={{
                    width: `${Math.min(100, Math.max(4, Math.round((progress.done / progress.total) * 100)))}%`,
                    height: '100%',
                    borderRadius: 999,
                    backgroundColor: colors.primary,
                  }}
                />
              </View>
              <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
                Added {progress.done} of {progress.total} players...
              </Text>
            </View>
          ) : null}
          <Button
            label={selected ? `Add to ${selected.name}` : 'Add'}
            disabled={!selected}
            loading={loading}
            onPress={() => {
              if (kind && selected) onConfirm({ kind, id: selected.id, name: selected.name });
            }}
          />
          <Button label="Cancel" variant="secondary" onPress={onClose} />
        </View>
      }
    >
      <View className="gap-4">
        <View>
          <Text className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
            Add To
          </Text>
          <View className="flex-row flex-wrap">
            <Chip
              label="Evaluation"
              active={kind === 'assessment'}
              onPress={() => {
                setKind('assessment');
                setTargetId(null);
              }}
            />
            <Chip
              label="Team"
              active={kind === 'team'}
              onPress={() => {
                setKind('team');
                setTargetId(null);
              }}
            />
          </View>
        </View>

        {kind === null ? (
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            Choose whether these players join an evaluation roster or a team roster.
          </Text>
        ) : listLoading ? (
          // Deliberately not <LoadingState>/<EmptyState> — both wrap themselves in
          // full-height containers meant for a screen, which collapse oddly inside
          // this modal's ScrollView.
          <View className="items-center py-6">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : options.length === 0 ? (
          <View className="py-4 gap-1">
            <Text className="text-base font-bold" style={{ color: colors.ink }}>
              {kind === 'assessment' ? 'No evaluations' : 'No teams'}
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {kind === 'assessment'
                ? 'Create an evaluation before adding players to one.'
                : 'Create a team before adding players to one.'}
            </Text>
          </View>
        ) : (
          <View>
            <Text className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
              {kind === 'assessment' ? 'Available Evaluations' : 'Available Teams'}
            </Text>
            <View className="gap-2">
              {options.map((o) => {
                const active = o.id === targetId;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => setTargetId(o.id)}
                    className="rounded-xl border px-4 py-3 flex-row items-center justify-between"
                    style={{
                      backgroundColor: active ? 'rgba(255,107,43,0.12)' : colors.tile,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <Text
                      className="text-base font-semibold flex-1"
                      style={{ color: active ? colors.primary : colors.ink }}
                    >
                      {o.name}
                    </Text>
                    {o.hint ? (
                      <Text className="text-xs ml-2" style={{ color: colors.inkMuted }}>
                        {o.hint}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
