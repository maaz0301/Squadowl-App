import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { Button, Chip, Input, Modal } from '@/components/ui';
import { isMetricScoringType, SCORING_TYPE_LABELS } from '@/data/rubrics';
import { SCORING_TYPES, SPORTS, type RubricLibraryInput, type RubricLibraryItem, type ScoringType } from '@/data/types';
import { parseTimeText } from '@/lib/timeEntry';
import { useThemeColors } from '@/theme/ThemeProvider';

const DEFAULT_UNIT: Partial<Record<ScoringType, string>> = { time: 'sec', distance: 'ft', speed: 'mph', quantity: 'reps' };

/** Create or edit one rubric in the library. */
export function RubricLibraryFormModal({
  visible,
  item,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  /** The rubric being edited; unset to create a new one. */
  item?: RubricLibraryItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: RubricLibraryInput) => void;
}) {
  const colors = useThemeColors();
  const d = item?.definition;
  const [name, setName] = useState(item?.name ?? '');
  const [sport, setSport] = useState(item?.sport ?? '');
  const [category, setCategory] = useState(d?.category ?? '');
  const [scoringType, setScoringType] = useState<ScoringType>(item?.scoringType ?? 'skill');
  const [scale, setScale] = useState<'1-5' | '1-10'>(d?.scale === '1-10' ? '1-10' : '1-5');
  const [unit, setUnit] = useState(d?.unit ?? '');
  const [minStr, setMinStr] = useState(d?.minVal != null ? String(d.minVal) : '');
  const [maxStr, setMaxStr] = useState(d?.maxVal != null ? String(d.maxVal) : '');
  const [lowerWins, setLowerWins] = useState(d?.rankingDirection === 'lower_is_better');
  const [weightStr, setWeightStr] = useState(d?.weight != null ? String(d.weight) : '');

  const isMetric = isMetricScoringType(scoringType);
  const read = (t: string) => (scoringType === 'time' ? parseTimeText(t, unit.trim() || 'sec') : parseFloat(t));
  const weight = weightStr.trim() !== '' ? parseFloat(weightStr) : undefined;
  const weightValid = weight == null || (!isNaN(weight) && weight >= 1 && weight <= 100);

  const save = () => {
    if (!name.trim() || !weightValid) return;
    const min = minStr.trim() !== '' ? read(minStr) : undefined;
    const max = maxStr.trim() !== '' ? read(maxStr) : undefined;
    onSave({
      name: name.trim(),
      sport: sport.trim() || undefined,
      scoringType,
      definition: {
        // Keep anything the form does not edit (a benchmark saved from an evaluation).
        ...(item?.definition ?? {}),
        category: category.trim() || undefined,
        scale: scoringType === 'skill' ? scale : '1-5',
        unit: isMetric ? unit.trim() || DEFAULT_UNIT[scoringType] : undefined,
        minVal: isMetric && min != null && !isNaN(min) ? min : undefined,
        maxVal: isMetric && max != null && !isNaN(max) ? max : undefined,
        rankingDirection: lowerWins ? 'lower_is_better' : 'higher_is_better',
        weight: weight != null && !isNaN(weight) ? weight : undefined,
      },
    });
  };

  return (
    <Modal
      visible={visible}
      title={item ? 'Edit Rubric' : 'New Rubric'}
      onClose={onClose}
      footer={<Button label={item ? 'Save changes' : 'Save to Library'} loading={saving} disabled={!name.trim() || !weightValid} onPress={save} />}
    >
      <View className="gap-3">
        <Input label="Rubric name" value={name} onChangeText={setName} placeholder="e.g. 30m Sprint, Edge Control" />
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          Sport (optional)
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SPORTS.map((s) => (
            <Chip key={s} label={s} active={sport === s} onPress={() => setSport(sport === s ? '' : s)} />
          ))}
        </View>
        <Input label="Category (optional)" value={category} onChangeText={setCategory} placeholder="e.g. Skating" />
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          Measure type
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SCORING_TYPES.map((t) => (
            <Chip key={t} label={SCORING_TYPE_LABELS[t]} active={scoringType === t} onPress={() => setScoringType(t)} />
          ))}
        </View>
        {scoringType === 'skill' ? (
          <View className="flex-row gap-2">
            <Chip label="1-5 Scale" active={scale === '1-5'} onPress={() => setScale('1-5')} />
            <Chip label="1-10 Scale" active={scale === '1-10'} onPress={() => setScale('1-10')} />
          </View>
        ) : null}
        {isMetric ? (
          <View className="gap-3">
            <Input label="Unit" value={unit} onChangeText={setUnit} placeholder={DEFAULT_UNIT[scoringType] ?? 'unit'} />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Input label="Min value" value={minStr} onChangeText={setMinStr} keyboardType={scoringType === 'time' ? 'default' : 'numeric'} />
              </View>
              <View className="flex-1">
                <Input label="Max value" value={maxStr} onChangeText={setMaxStr} keyboardType={scoringType === 'time' ? 'default' : 'numeric'} />
              </View>
            </View>
          </View>
        ) : null}
        {scoringType !== 'skill' && scoringType !== 'yes_no' && scoringType !== 'effectiveness' ? (
          <Pressable onPress={() => setLowerWins(!lowerWins)} className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-base" style={{ color: colors.ink }}>
              Lowest value ranks best (e.g. fastest sprint)
            </Text>
            <Switch value={lowerWins} onValueChange={setLowerWins} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
          </Pressable>
        ) : null}
        <Input
          label="Weight (% of the overall score, optional)"
          value={weightStr}
          onChangeText={setWeightStr}
          keyboardType="numeric"
          placeholder="e.g. 25"
          error={weightValid ? undefined : 'Weight must be a number between 1 and 100.'}
        />
      </View>
    </Modal>
  );
}
