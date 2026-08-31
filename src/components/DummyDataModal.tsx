import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Chip, Input, Modal } from '@/components/ui';
import {
  DUMMY_LIMITS,
  clampOption,
  type DummyDataOptions,
  type DummyTarget,
  type DummyTeamOptions,
} from '@/data/testDataGenerator';

/**
 * The one "Dummy Data" dialog, shared by the in-assessment testing tools and the
 * New Team screen. Both variants ask the same four things — what to create, how
 * many, whether to score it, and how many scoring sessions per player — and
 * differ only in the choices offered and what "how many" counts.
 */

type Variant = 'assessment' | 'team';

const ASSESSMENT_TARGETS: { key: DummyTarget; label: string; hint: string }[] = [
  {
    key: 'registrations',
    label: 'Registrations',
    hint: 'Pending registrations with guardian details — land in the Pending tab so you can test approve/dismiss.',
  },
  {
    key: 'roster',
    label: 'Roster players',
    hint: 'Players added straight to the roster, skipping registration.',
  },
  {
    key: 'both',
    label: 'Both',
    hint: 'A pending queue plus a separate cohort already on the roster.',
  },
];

interface AssessmentProps {
  variant: 'assessment';
  visible: boolean;
  loading?: boolean;
  /** How many of the requested records have been created so far — counted
   * across generation and insertion, whatever the target. */
  progress?: { done: number; total: number };
  /** Blocks the scoring options and explains why — no rubrics defined yet. */
  hasRubrics: boolean;
  onAddRubrics: () => void;
  onClose: () => void;
  onSubmit: (options: DummyDataOptions) => void;
}

interface TeamProps {
  variant: 'team';
  visible: boolean;
  loading?: boolean;
  progress?: { done: number; total: number };
  onClose: () => void;
  onSubmit: (options: DummyTeamOptions) => void;
}

export type DummyDataModalProps = AssessmentProps | TeamProps;

export function DummyDataModal(props: DummyDataModalProps) {
  const colors = useThemeColors();
  const isTeam = props.variant === 'team';

  const [target, setTarget] = useState<DummyTarget>('registrations');
  const [count, setCount] = useState('25');
  const [teams, setTeams] = useState('2');
  const [withScores, setWithScores] = useState(true);
  const [sessions, setSessions] = useState('1');

  // Registrations have nowhere to hang a score, so the scoring options only
  // apply once the batch puts someone on a roster.
  const producesRoster = isTeam || target === 'roster' || target === 'both';
  const hasRubrics = isTeam || props.hasRubrics;
  const canScore = producesRoster && hasRubrics;
  const scoring = canScore && withScores;

  const countN = clampOption(count, isTeam ? DUMMY_LIMITS.playersPerTeam : DUMMY_LIMITS.count, 25);
  const teamsN = clampOption(teams, DUMMY_LIMITS.teams, 2);
  const sessionsN = clampOption(sessions, DUMMY_LIMITS.sessionsPerPlayer, 1);

  const submit = () => {
    if (isTeam) {
      props.onSubmit({
        teams: teamsN,
        playersPerTeam: countN,
        withScores: scoring,
        sessionsPerPlayer: sessionsN,
      });
    } else {
      props.onSubmit({
        target,
        count: countN,
        withScores: scoring,
        sessionsPerPlayer: sessionsN,
      });
    }
  };

  const submitLabel = isTeam
    ? `Create ${teamsN} ${teamsN === 1 ? 'Team' : 'Teams'} · ${countN * teamsN} Players`
    : `Create ${target === 'both' ? countN * 2 : countN} Records`;

  // An assessment with no rubrics can still generate unscored records, but the
  // user probably wants rubrics first — say so instead of silently degrading.
  const rubricNotice = !isTeam && !props.hasRubrics && producesRoster;

  return (
    <Modal
      visible={props.visible}
      title={isTeam ? 'Dummy Teams' : 'Dummy Data'}
      onClose={props.onClose}
      footer={
        <View className="mt-4 gap-2">
          {props.loading && props.progress && props.progress.total > 0 ? (
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
                    width: `${Math.min(100, Math.max(4, Math.round((props.progress.done / props.progress.total) * 100)))}%`,
                    height: '100%',
                    borderRadius: 999,
                    backgroundColor: colors.primary,
                  }}
                />
              </View>
              <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
                {isTeam
                  ? `Generated ${props.progress.done} of ${props.progress.total} players...`
                  : `Created ${props.progress.done} of ${props.progress.total} records...`}
              </Text>
            </View>
          ) : null}
          <Button label={submitLabel} loading={props.loading} onPress={submit} />
        </View>
      }
    >
      <View className="gap-5 py-1">
        {isTeam ? (
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            Teams hold no roster of their own, so each dummy team is created with a linked
            evaluation — seeded with rubrics covering skill, time, distance, and speed — and the
            players are added there.
          </Text>
        ) : (
          <View className="gap-2">
            <Text className="text-sm font-bold" style={{ color: colors.ink }}>
              What do you want to create?
            </Text>
            <View className="flex-row flex-wrap">
              {ASSESSMENT_TARGETS.map((t) => (
                <Chip
                  key={t.key}
                  label={t.label}
                  active={target === t.key}
                  onPress={() => setTarget(t.key)}
                />
              ))}
            </View>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {ASSESSMENT_TARGETS.find((t) => t.key === target)?.hint}
            </Text>
          </View>
        )}

        {isTeam ? (
          <Input
            label={`How many teams (${DUMMY_LIMITS.teams.min}–${DUMMY_LIMITS.teams.max})`}
            value={teams}
            onChangeText={setTeams}
            keyboardType="number-pad"
            placeholder="2"
          />
        ) : null}

        <Input
          label={
            isTeam
              ? `Players per team (${DUMMY_LIMITS.playersPerTeam.min}–${DUMMY_LIMITS.playersPerTeam.max})`
              : `How many players (${DUMMY_LIMITS.count.min}–${DUMMY_LIMITS.count.max})`
          }
          value={count}
          onChangeText={setCount}
          keyboardType="number-pad"
          placeholder="25"
        />

        {rubricNotice ? (
          <View className="gap-2">
            <Text className="text-sm" style={{ color: colors.ink }}>
              Players are scored against this evaluation's rubrics, but none are defined yet. Add at
              least one rubric to generate scoring data — or continue to create unscored players.
            </Text>
            <Button label="Add Rubrics" variant="secondary" size="sm" onPress={props.onAddRubrics} />
          </View>
        ) : null}

        {producesRoster ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-4">
                <Text className="text-sm font-bold" style={{ color: colors.ink }}>
                  Scoring data
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {canScore
                    ? 'Score every player across every rubric so rankings and reports have data.'
                    : 'Unavailable until this evaluation has at least one rubric.'}
                </Text>
              </View>
              <Switch
                value={scoring}
                disabled={!canScore}
                onValueChange={setWithScores}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>

            {scoring ? (
              <Input
                label={`Scoring evaluations per player (${DUMMY_LIMITS.sessionsPerPlayer.min}–${DUMMY_LIMITS.sessionsPerPlayer.max})`}
                value={sessions}
                onChangeText={setSessions}
                keyboardType="number-pad"
                placeholder="1"
              />
            ) : null}
          </View>
        ) : null}

        <Text className="text-xs" style={{ color: colors.inkMuted }}>
          Everything generated is tagged so it can be removed again with Clear Dummy Data. Guardian
          emails use a reserved test domain and can never reach a real inbox.
        </Text>
      </View>
    </Modal>
  );
}
