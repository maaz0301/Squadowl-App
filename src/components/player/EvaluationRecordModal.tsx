import { Text, View } from 'react-native';

import { Badge, Modal } from '@/components/ui';
import type { PlayerProfileAssessment } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

/** "ice_skating" -> "Ice skating": category keys as a coach would read them. */
const titleize = (key: string) => {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
};

/**
 * The permanent record of one evaluation in a player's history: what it was,
 * when and for whom, how the player finished, and every session that went into
 * it. Read-only; it is the "tombstone" a coach looks back at after the event.
 */
export function EvaluationRecordModal({
  assessment,
  onClose,
}: {
  assessment: PlayerProfileAssessment | null;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const a = assessment;
  const evaluators = a ? [...new Set((a.evaluations ?? []).map((e) => e.evaluator).filter(Boolean))] : [];
  const sessions = a ? [...(a.evaluations ?? [])].sort((x, y) => x.createdAt - y.createdAt) : [];

  const field = (label: string, value?: string | number | null) => (
    <View className="flex-row justify-between gap-3">
      <Text className="text-sm" style={{ color: colors.inkMuted }}>{label}</Text>
      <Text className="text-sm font-medium flex-1 text-right" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '-'}
      </Text>
    </View>
  );
  const heading = (text: string) => (
    <Text className="text-xs font-bold uppercase mt-1 mb-1.5" style={{ color: colors.inkMuted }}>{text}</Text>
  );

  return (
    <Modal visible={!!a} title={a?.tryoutName ?? 'Evaluation'} onClose={onClose}>
      {a ? (
        <View className="gap-4">
          <View className="gap-1.5">
            {heading('Record')}
            {field('Event type', a.eventType)}
            {field('Sport', a.sport)}
            {field('Date', a.date)}
            {field('Season', a.seasonName)}
            {field('Team', a.teamName)}
            {field('Position', a.position)}
            {field('Sessions scored', a.evalCount)}
            {field('Evaluators', evaluators.join(', '))}
          </View>

          <View className="gap-1.5">
            {heading('Result')}
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-sm" style={{ color: colors.inkMuted }}>Overall score</Text>
              <Text className="text-lg font-bold" style={{ color: colors.primary }}>
                {a.evalCount > 0 ? a.overall.toFixed(1) : 'Not yet scored'}
              </Text>
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-sm" style={{ color: colors.inkMuted }}>Recommendation</Text>
              {a.latestRecommendation ? (
                <Badge label={a.latestRecommendation} variant="brand" />
              ) : (
                <Text className="text-sm" style={{ color: colors.inkFaint }}>-</Text>
              )}
            </View>
            {Object.entries(a.categoryScores).map(([key, value]) => (
              <View key={key} className="flex-row justify-between gap-3">
                <Text className="text-sm" style={{ color: colors.inkMuted }}>{titleize(key)}</Text>
                <Text className="text-sm font-medium" style={{ color: colors.ink }}>{value.toFixed(1)}</Text>
              </View>
            ))}
          </View>

          {sessions.length > 0 ? (
            <View className="gap-2">
              {heading('Sessions')}
              {sessions.map((ev) => (
                <View
                  key={ev.id}
                  className="gap-0.5 rounded-md border px-3 py-2"
                  style={{ backgroundColor: colors.tile, borderColor: colors.border }}
                >
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="text-sm font-bold flex-1" style={{ color: colors.ink }}>
                      {ev.session || 'Session'} · {ev.date || '-'}
                    </Text>
                    <Text className="text-sm font-bold" style={{ color: colors.primary }}>{ev.overall.toFixed(1)}</Text>
                  </View>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    {ev.evaluator || 'Unknown evaluator'}
                    {ev.recommendation ? ` · ${ev.recommendation}` : ''}
                  </Text>
                  {ev.strengths ? <Text className="text-sm" style={{ color: colors.ink }}>+ {ev.strengths}</Text> : null}
                  {ev.improve ? <Text className="text-sm" style={{ color: colors.inkMuted }}>→ {ev.improve}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}
