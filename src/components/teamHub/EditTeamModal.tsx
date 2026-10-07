import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import { Avatar, Button, Card, Chip, Input, Modal } from '@/components/ui';
import { TeamColorPicker } from '@/components/TeamColorPicker';
import { useUpdateTeamMutation, useUploadTeamLogoMutation } from '@/features/queries';
import type { Team } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

function feeCentsFromInput(feeInput: string): number {
  const dollars = parseFloat(feeInput);
  return !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
}

/**
 * The Edit Team form. It owns its own field state so typing in it re-renders
 * this modal only, not the whole team hub behind it.
 */
function EditTeamForm({
  team,
  canCollectFees,
  onClose,
}: {
  team: Team;
  canCollectFees: boolean;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const updateTeam = useUpdateTeamMutation();
  const uploadLogo = useUploadTeamLogoMutation();

  const [brandColor, setBrandColor] = useState<string | null>(team.brandColor ?? null);
  const [name, setName] = useState(team.name);
  const [season, setSeason] = useState(team.season ?? '');
  const [logo, setLogo] = useState<{ uri: string; type: string } | null>(null);
  const [collectsFees, setCollectsFees] = useState(team.collectsFees ?? false);
  const [feeInput, setFeeInput] = useState(
    team.registrationFeeCents ? (team.registrationFeeCents / 100).toFixed(2) : '',
  );

  const handleSelectLogo = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        includeBase64: false,
      });
      if (result.didCancel || !result.assets?.length) return;

      const asset = result.assets[0];
      if (asset.uri && asset.type) {
        setLogo({ uri: asset.uri, type: asset.type });
      }
    } catch (e: any) {
      Alert.alert('Error', 'Failed to select image: ' + e.message);
    }
  };

  const save = async () => {
    let logoUrl = team.logoUrl;
    if (logo) {
      try {
        logoUrl = await uploadLogo.mutateAsync({
          teamId: team.id,
          fileUri: logo.uri,
          fileType: logo.type,
        });
      } catch (e: any) {
        Alert.alert('Logo Upload Error', 'Failed to upload logo: ' + e.message);
        return;
      }
    }
    // Only touch fee fields when the coach's plan can actually collect fees —
    // a free-tier coach never sees the toggle below, so leave whatever's
    // already stored (e.g. from before a downgrade) untouched here.
    const feeUpdates = canCollectFees
      ? collectsFees
        ? { collectsFees: true, registrationFeeCents: feeCentsFromInput(feeInput) }
        : { collectsFees: false, registrationFeeCents: 0 }
      : {};

    try {
      await updateTeam.mutateAsync({
        id: team.id,
        // '' rather than undefined when no colour is picked: undefined is "leave
        // it alone" in updateTeam's patch builder, so clearing a colour has to be
        // an explicit empty value to reach the column as NULL.
        updates: {
          name: name.trim(),
          season: season.trim() || undefined,
          logoUrl,
          brandColor: brandColor ?? '',
          ...feeUpdates,
        },
      });
    } catch (e: any) {
      // The form is hidden from anyone who'd hit the RLS check on save, but
      // surface a readable message instead of a raw Postgres error on the off
      // chance the client's view of the team is stale.
      Alert.alert('Error', e?.message || 'Could not save these changes.');
      return;
    }
    onClose();
  };

  return (
    <View className="gap-3">
        <Pressable onPress={handleSelectLogo} className="items-center mb-2 mt-4">
          <View className="mb-3">
            <Avatar uri={logo?.uri || team?.logoUrl} first="T" last="M" size={80} />
          </View>
          <Text className="font-bold text-sm" style={{ color: colors.primary }}>
            Change Team Logo
          </Text>
        </Pressable>
        <Input label="Team name" value={name} onChangeText={setName} />
        <Input label="Season" value={season} onChangeText={setSeason} />

        <TeamColorPicker value={brandColor} onChange={setBrandColor} />

        {canCollectFees ? (
          <>
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Are you collecting fees?
              </Text>
              <View className="flex-row gap-2">
                <Chip label="No" active={!collectsFees} onPress={() => setCollectsFees(false)} />
                <Chip label="Yes" active={collectsFees} onPress={() => setCollectsFees(true)} />
              </View>
            </View>

            {collectsFees ? (
              <Card className="gap-2">
                <Input
                  label="Fee per player (CAD)"
                  value={feeInput}
                  onChangeText={setFeeInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Saving this creates (or reuses) this team's season and adds everyone currently on
                  the roster to it, each player's guardian will then be asked to pay this fee, plus
                  SquadOwl's 0.5% platform fee, from their portal.
                </Text>
              </Card>
            ) : null}
          </>
        ) : null}

        <Button label="Save Changes" onPress={save} loading={updateTeam.isPending || uploadLogo.isPending} />
    </View>
  );
}

/** Mounts a fresh form each time it opens, so fields always start from the team's current values. */
export function EditTeamModal({
  visible,
  team,
  canCollectFees,
  onClose,
}: {
  visible: boolean;
  team: Team;
  canCollectFees: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} title="Edit Team" onClose={onClose}>
      {visible ? <EditTeamForm team={team} canCollectFees={canCollectFees} onClose={onClose} /> : null}
    </Modal>
  );
}
