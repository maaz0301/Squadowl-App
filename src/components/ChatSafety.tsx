import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Button, Modal } from '@/components/ui';
import {
  useBlockChatUserMutation,
  useBlockedChatUsersQuery,
  useReportTeamMessageMutation,
  useUnblockChatUserMutation,
} from '@/features/queries';
import type { ChatReportReason, TeamMessage } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

const REASONS: { value: ChatReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate or unsafe content' },
  { value: 'other', label: 'Something else' },
];

/**
 * Report and block for team chat, kept out of TeamChat so the conversation's own
 * code stays about the conversation. `openActions(message)` is what a message's
 * menu button (or long press) calls; `modals` has to be rendered once by the chat.
 *
 * Blocking only hides that person from the blocker, and is undone from "Blocked
 * people". Reporting sends the message to the platform operators for review; it
 * does not delete the message or tell the team.
 */
export function useChatSafety() {
  const colors = useThemeColors();
  const blockedQuery = useBlockedChatUsersQuery();
  const blockUser = useBlockChatUserMutation();
  const unblockUser = useUnblockChatUserMutation();
  const reportMessage = useReportTeamMessageMutation();

  const [actionsFor, setActionsFor] = useState<TeamMessage | null>(null);
  const [reportFor, setReportFor] = useState<TeamMessage | null>(null);
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [blockedOpen, setBlockedOpen] = useState(false);

  const blocked = blockedQuery.data ?? [];

  const startReport = (message: TeamMessage) => {
    setActionsFor(null);
    setReason(null);
    setDetails('');
    setReportFor(message);
  };

  const submitReport = async () => {
    if (!reportFor || !reason) return;
    try {
      await reportMessage.mutateAsync({ messageId: reportFor.id, reason, details });
      setReportFor(null);
      Alert.alert(
        'Report Sent',
        'Thank you. We will review this message. You can also block this person so you no longer see their messages.',
      );
    } catch (e: any) {
      Alert.alert('Could Not Send Report', e?.message || 'Please try again.');
    }
  };

  const startBlock = (message: TeamMessage) => {
    setActionsFor(null);
    // A short delay lets the sheet finish closing; an Alert raised in the same
    // tick as a Modal dismissal is dropped on iOS.
    setTimeout(() => {
      Alert.alert(
        `Block ${message.authorName}?`,
        'You will no longer see their messages or get notifications from them in team chat. They are not told, and nobody else is affected. You can unblock them any time from Blocked people.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: async () => {
              try {
                await blockUser.mutateAsync(message.authorUserId);
              } catch (e: any) {
                Alert.alert('Could Not Block', e?.message || 'Please try again.');
              }
            },
          },
        ],
      );
    }, 350);
  };

  const modals: ReactNode = (
    <>
      <Modal visible={!!actionsFor} title="Message" onClose={() => setActionsFor(null)}>
        {actionsFor ? (
          <View className="gap-2">
            <Text className="text-sm" numberOfLines={3} style={{ color: colors.inkMuted }}>
              {actionsFor.authorName}: {actionsFor.body}
            </Text>
            <Button label="Report message" variant="secondary" onPress={() => startReport(actionsFor)} />
            <Button label={`Block ${actionsFor.authorName}`} variant="danger" onPress={() => startBlock(actionsFor)} />
          </View>
        ) : null}
      </Modal>

      <Modal visible={!!reportFor} title="Report Message" onClose={() => setReportFor(null)}>
        {reportFor ? (
          <View className="gap-3">
            <Text
              className="text-sm rounded-lg p-3"
              numberOfLines={3}
              style={{ backgroundColor: colors.tile, color: colors.inkMuted }}
            >
              {reportFor.authorName}: {reportFor.body}
            </Text>
            <Text className="text-sm font-bold" style={{ color: colors.ink }}>
              What is wrong with it?
            </Text>
            {REASONS.map((r) => {
              const selected = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setReason(r.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className="rounded-lg px-3 py-3"
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? 'rgba(255,107,43,0.10)' : colors.tile,
                  }}
                >
                  <Text className="text-sm" style={{ color: colors.ink }}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Details (optional)"
              placeholderTextColor={colors.placeholder}
              multiline
              maxLength={1000}
              className="rounded-lg px-3 py-3 text-[15px]"
              style={{
                minHeight: 80,
                textAlignVertical: 'top',
                backgroundColor: colors.tile,
                color: colors.ink,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            />
            <Button label="Send report" disabled={!reason} loading={reportMessage.isPending} onPress={submitReport} />
          </View>
        ) : null}
      </Modal>

      <Modal visible={blockedOpen} title="Blocked people" onClose={() => setBlockedOpen(false)}>
        {blocked.length === 0 ? (
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            You have not blocked anyone.
          </Text>
        ) : (
          <View className="gap-2">
            {blocked.map((b) => (
              <View
                key={b.userId}
                className="flex-row items-center justify-between gap-3 rounded-lg px-3 py-2"
                style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.tile }}
              >
                <Text className="flex-1 text-sm font-bold" numberOfLines={1} style={{ color: colors.ink }}>
                  {b.name}
                </Text>
                {unblockUser.isPending && unblockUser.variables === b.userId ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Button label="Unblock" size="sm" variant="secondary" onPress={() => unblockUser.mutate(b.userId)} />
                )}
              </View>
            ))}
          </View>
        )}
      </Modal>
    </>
  );

  return {
    openActions: (message: TeamMessage) => setActionsFor(message),
    blockedCount: blocked.length,
    openBlocked: () => setBlockedOpen(true),
    modals,
  };
}
