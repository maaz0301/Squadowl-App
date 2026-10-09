import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Button, Card, Input } from '@/components/ui';
import type { CustomLabels } from '@/data/types';
import { sportProfile } from '@/data/sportProfile';
import { DEFAULT_TERMS, LABEL_MAX_LENGTH, pluralize } from '@/lib/terms';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Rename a few terms for one evaluation, e.g. Player -> Skater, Jersey # ->
 * Skate Ontario #, Hockey -> Skating. Blank keeps the standard name.
 */
export function TermsEditor({
  value,
  sport: evalSport,
  saving,
  onSave,
}: {
  value?: CustomLabels;
  /** The evaluation's sport, so the defaults shown match its player card. */
  sport?: string;
  saving: boolean;
  onSave: (labels: CustomLabels) => Promise<void>;
}) {
  const colors = useThemeColors();
  const profile = sportProfile(evalSport);
  const [player, setPlayer] = useState(value?.player ?? '');
  const [jersey, setJersey] = useState(value?.jersey ?? '');
  const [sport, setSport] = useState(value?.sport ?? '');

  const dirty =
    player.trim() !== (value?.player ?? '') || jersey.trim() !== (value?.jersey ?? '') || sport.trim() !== (value?.sport ?? '');

  const save = async (next: { player: string; jersey: string; sport: string }) => {
    const labels = Object.fromEntries(
      Object.entries(next)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    ) as CustomLabels;
    try {
      await onSave(labels);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const reset = () => {
    setPlayer('');
    setJersey('');
    setSport('');
    void save({ player: '', jersey: '', sport: '' });
  };

  return (
    <Card className="mb-4 gap-3">
      <Text className="font-display font-bold" style={{ color: colors.ink }}>Custom field names</Text>
      <Text className="text-sm" style={{ color: colors.inkMuted }}>
        Rename terms for this evaluation only. Leave a field blank to keep the standard name.
      </Text>
      <Input
        label={`Player (default: ${profile.player})`}
        value={player}
        onChangeText={setPlayer}
        placeholder="e.g. Skater"
        maxLength={LABEL_MAX_LENGTH}
      />
      {player.trim() ? (
        <Text className="text-xs" style={{ color: colors.inkFaint }}>Plural shown as "{pluralize(player.trim())}".</Text>
      ) : null}
      <Input
        label={`Number label (default: ${profile.numberLabel})`}
        value={jersey}
        onChangeText={setJersey}
        placeholder="e.g. Skate Ontario #"
        maxLength={LABEL_MAX_LENGTH}
      />
      <Input
        label={`Sport name (default: ${DEFAULT_TERMS.sport})`}
        value={sport}
        onChangeText={setSport}
        placeholder="e.g. Skating"
        maxLength={LABEL_MAX_LENGTH}
      />
      <View className="flex-row gap-2">
        <Button label="Save" loading={saving} disabled={!dirty} onPress={() => save({ player, jersey, sport })} />
        <Button label="Reset to defaults" variant="ghost" onPress={reset} />
      </View>
    </Card>
  );
}
