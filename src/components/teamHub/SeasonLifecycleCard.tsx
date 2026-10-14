import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Input, Modal } from '@/components/ui';
import { useCreateSeasonMutation, useUpdateSeasonMutation, useUpdateTeamMutation } from '@/features/queries';
import type { Season, Team } from '@/data/types';

/** "2025-26" to "2026-27"; anything else is left for the coach to type. */
function nextYearLabel(label: string | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec((label ?? '').trim());
  if (!m) return '';
  const start = Number(m[1]) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const notify = (title: string, message: string) => {
  if (Platform.OS === 'web') (globalThis as any).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
};

/**
 * End a team's season (archives it with its schedule and results kept) and start
 * the next one on the same team. The roster stays on the team and is carried
 * into the new season. Same card as the web team page's Options tab.
 */
export function SeasonLifecycleCard({
  team,
  currentSeason,
}: {
  team: Team;
  /** The team's active season, when it has one. */
  currentSeason?: Pick<Season, 'id' | 'name' | 'year' | 'division'>;
}) {
  const colors = useThemeColors();
  const updateSeason = useUpdateSeasonMutation();
  const updateTeam = useUpdateTeamMutation();
  const createSeason = useCreateSeasonMutation();
  const [starting, setStarting] = useState(false);
  // Whether a season was still open when the dialog opened, so the warning does not
  // flip on for the season this very dialog just created.
  const [openAtStart, setOpenAtStart] = useState(false);
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [division, setDivision] = useState('');

  const openStart = () => {
    const nextYear = nextYearLabel(currentSeason?.year ?? team.season);
    setYear(nextYear);
    setName(nextYear ? `${nextYear} ${team.name}` : `${team.name} Season`);
    setDivision(currentSeason?.division ?? '');
    setOpenAtStart(!!currentSeason);
    setStarting(true);
  };

  const end = () => {
    if (!currentSeason) return;
    Alert.alert(
      'End Season',
      `End "${currentSeason.name}" and archive it? Its schedule, attendance and results are kept. ${team.name} stays active with its roster, and you can start a new season right after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End & archive',
          onPress: async () => {
            try {
              await updateSeason.mutateAsync({ id: currentSeason.id, updates: { archived: true } });
            } catch (e: any) {
              notify('Could Not End Season', e?.message || 'Something went wrong.');
            }
          },
        },
      ],
    );
  };

  const start = async () => {
    if (!name.trim()) {
      notify('Name Required', 'Give the new season a name.');
      return;
    }
    try {
      await createSeason.mutateAsync({
        name: name.trim(),
        teamName: team.name,
        sport: (team.sport as never) ?? 'Hockey',
        year: year.trim() || undefined,
        division: division.trim() || undefined,
        teamId: team.id,
      });
      if (year.trim()) await updateTeam.mutateAsync({ id: team.id, updates: { season: year.trim() } });
      setStarting(false);
    } catch (e: any) {
      notify('Could Not Start Season', e?.message || 'Something went wrong.');
    }
  };

  return (
    <>
      <Card className="gap-2">
        <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          Season
        </Text>
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          {currentSeason
            ? `Current season: ${currentSeason.name}. Ending it archives its schedule and results; the roster stays on the team.`
            : 'This team has no active season. Start one to get the schedule, RSVPs and chat for the new year.'}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {currentSeason ? (
            <Button label="End Season & Archive" variant="secondary" size="sm" onPress={end} loading={updateSeason.isPending} />
          ) : null}
          <Button label="Start New Season" size="sm" onPress={openStart} />
        </View>
      </Card>

      <Modal visible={starting} title="Start New Season" onClose={() => setStarting(false)}>
        <View className="gap-3">
          {openAtStart && currentSeason ? (
            <Text className="text-xs" style={{ color: colors.warning }}>
              "{currentSeason.name}" is still active. End it first, or both seasons stay open on this team.
            </Text>
          ) : null}
          <Input label="Season name" value={name} onChangeText={setName} />
          <Input label="Year" value={year} onChangeText={setYear} placeholder="2026-27" />
          <Input label="Division" value={division} onChangeText={setDivision} placeholder="U14 AA" />
          <Text className="text-xs" style={{ color: colors.inkFaint }}>
            The team's current players are added to the new season.
          </Text>
          <Button label="Start season" loading={createSeason.isPending || updateTeam.isPending} onPress={start} />
        </View>
      </Modal>
    </>
  );
}
