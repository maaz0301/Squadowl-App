import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Badge, Button, Input, Modal } from '@/components/ui';
import {
  LETTER_KIND_LABELS,
  buildLetterVars,
  letterRecipient,
  renderLetter,
  unfilledTokens,
} from '@/data/letters';
import { playerDisplayName } from '@/data/rubrics';
import type { LetterTemplate, Player, Tryout } from '@/data/types';
import { useLetterTemplatesQuery, useSendPlayerLettersMutation, useTeamsQuery } from '@/features/queries';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Alert.alert is a no-op on react-native-web, so fall back to the DOM dialog. */
function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      resolve((globalThis as any).confirm?.(`${title}\n\n${message}`) ?? false);
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, onPress: () => resolve(true) },
    ]);
  });
}

/**
 * Send an offer or roster decision letter to one player, from their own card.
 *
 * The same templates, substitutions and send path as the Letters tool, which is
 * built for sending to many players at once. Here the coach picks a template,
 * sees it already filled in for this player, can change the wording for just
 * this letter, and sends. A copy is attached to the player's card either way.
 */
export function PlayerLetterModal({
  tryout,
  player,
  visible,
  onClose,
  onOpenTool,
}: {
  tryout: Tryout;
  player: Player;
  visible: boolean;
  onClose: () => void;
  /** Opens the full Letters tool, for writing or editing templates. */
  onOpenTool: () => void;
}) {
  const colors = useThemeColors();
  const user = useUser();
  const templatesQuery = useLetterTemplatesQuery({ enabled: visible });
  const teamsQuery = useTeamsQuery();
  const send = useSendPlayerLettersMutation(tryout.id);

  const [template, setTemplate] = useState<LetterTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState(letterRecipient(player) ?? '');

  const team = teamsQuery.data?.find((t) => t.id === tryout.teamId);
  const vars = useMemo(
    () =>
      buildLetterVars({
        playerFirst: player.first,
        playerLast: player.last,
        guardianName: player.guardianName,
        teamName: team?.name || tryout.name,
        seasonName: team?.season || tryout.tryoutDate?.slice(0, 4),
        coachName: tryout.headCoach || tryout.headAssessor || user?.displayName,
        coachEmail: tryout.headAssessorEmail || user?.email,
      }),
    [player, team, tryout, user],
  );

  const pick = (t: LetterTemplate) => {
    setTemplate(t);
    setTo(letterRecipient(player) ?? '');
    setSubject(renderLetter(t.subject, vars));
    setBody(renderLetter(t.body, vars));
  };
  const close = () => {
    setTemplate(null);
    onClose();
  };

  const templates = templatesQuery.data ?? [];
  const leftover = unfilledTokens(`${subject}\n${body}`);
  const name = playerDisplayName(player);

  const submit = async () => {
    if (!template) return;
    const address = to.trim();
    const ok = await confirmAsync(
      'Send letter?',
      [
        address
          ? `"${subject}" will be emailed to ${address}, and a copy attached to ${name}'s card.`
          : `There is no email address, so this will be saved to ${name}'s card as not sent.`,
        leftover.length
          ? `${leftover.map((t) => `{{${t}}}`).join(', ')} ${leftover.length === 1 ? 'has' : 'have'} not been filled in and will be sent as-is.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      'Send',
    );
    if (!ok) return;
    try {
      const [result] = await send.mutateAsync([
        {
          playerId: player.id,
          playerName: name,
          athleteId: player.athleteId,
          templateId: template.id,
          kind: template.kind,
          subject,
          body,
          recipientEmail: address || undefined,
        },
      ]);
      if (result?.error) Alert.alert('Not sent', result.error);
      else close();
    } catch (e: any) {
      Alert.alert('Send failed', e?.message || 'Could not send the letter.');
    }
  };

  return (
    <Modal visible={visible} title="Send a Letter" onClose={close}>
      {!template ? (
        <View className="gap-2">
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            Choose a letter for {name}. It is filled in for them and kept on their card.
          </Text>
          {templatesQuery.isLoading ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Loading letters...
            </Text>
          ) : templates.length === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              No letters written yet. Create an offer or roster decision letter in the Letters tool first.
            </Text>
          ) : (
            templates.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => pick(t)}
                className="flex-row items-center justify-between gap-2 rounded-xl border px-4 py-3"
                style={{ backgroundColor: colors.tile, borderColor: colors.border }}
              >
                <View className="flex-1">
                  <Text className="font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.inkMuted }} numberOfLines={1}>
                    {t.subject}
                  </Text>
                </View>
                <Badge label={LETTER_KIND_LABELS[t.kind]} variant={t.kind === 'offer' ? 'success' : 'info'} />
              </Pressable>
            ))
          )}
          <View className="flex-row justify-between pt-2">
            <Button label="Open Letters tool" variant="ghost" size="sm" onPress={onOpenTool} />
            <Button label="Cancel" variant="secondary" size="sm" onPress={close} />
          </View>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
          <View className="gap-3">
            <Input label="To" value={to} onChangeText={setTo} placeholder="Email address" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Subject" value={subject} onChangeText={setSubject} />
            <Input
              label="Letter"
              value={body}
              onChangeText={setBody}
              multiline
              numberOfLines={12}
              style={{ minHeight: 220, textAlignVertical: 'top' }}
            />
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              Changes here apply to this letter only, not the template.
            </Text>
            {leftover.length ? (
              <Text className="text-xs" style={{ color: colors.warning }}>
                Still to fill in: {leftover.map((t) => `{{${t}}}`).join(', ')}
              </Text>
            ) : null}
            <View className="flex-row justify-between gap-2">
              <Button label="Back" variant="secondary" onPress={() => setTemplate(null)} />
              <Button label="Send letter" onPress={submit} loading={send.isPending} />
            </View>
          </View>
        </ScrollView>
      )}
    </Modal>
  );
}
