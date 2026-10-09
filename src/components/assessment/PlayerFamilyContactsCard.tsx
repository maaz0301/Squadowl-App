import { useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { Badge, Button, Card } from '@/components/ui';
import { useConnectedFamilyContactIdsQuery, useFamilyContactsQuery } from '@/features/queries';
import { describeInvite, useInviteFamilyContact } from '@/features/useInviteFamilyContact';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * The additional family members on an athlete, beside the guardian on file:
 * who they are, whether they are connected to the guardian portal, and (for a
 * coach or team manager) an Invite that creates their login and connects them.
 */
export function PlayerFamilyContactsCard({
  athleteId,
  athleteName,
  linkedGuardianId,
  guardianEmail,
  canInvite,
  onRemove,
}: {
  athleteId: string;
  athleteName: string;
  linkedGuardianId?: string;
  guardianEmail?: string;
  canInvite: boolean;
  /** When set, each contact gets a Remove action (the guardian manages their own list). */
  onRemove?: (contactId: string) => void;
}) {
  const colors = useThemeColors();
  const contactsQuery = useFamilyContactsQuery(athleteId);
  const connectedQuery = useConnectedFamilyContactIdsQuery(athleteId);
  const inviteContact = useInviteFamilyContact();
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const contacts = contactsQuery.data ?? [];
  const connected = new Set(connectedQuery.data ?? []);

  const invite = async (contact: { id: string; name: string; email?: string }) => {
    setInvitingId(contact.id);
    try {
      const result = await inviteContact(contact, { athleteId, linkedGuardianId, guardianEmail });
      if (result) {
        Alert.alert('Invite Sent', describeInvite(result, contact.name, athleteName));
        void connectedQuery.refetch();
      }
    } catch (e: any) {
      Alert.alert('Invite Failed', e?.message || 'Could not invite this contact.');
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <Card className="mb-4 gap-2">
      <Text className="font-display font-bold" style={{ color: colors.ink }}>Family Contacts</Text>
      {contactsQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : contacts.length === 0 ? (
        <Text className="text-sm" style={{ color: colors.inkFaint }}>No additional contacts added yet.</Text>
      ) : (
        <View className="gap-2">
          {contacts.map((c) => (
            <View
              key={c.id}
              className="flex-row items-center justify-between gap-2 border-b pb-2"
              style={{ borderColor: colors.border }}
            >
              <View className="flex-1">
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {c.name}
                  {c.relationship ? ` · ${c.relationship}` : ''}
                </Text>
                {c.email ? <Text className="text-xs" style={{ color: colors.inkMuted }}>{c.email}</Text> : null}
                {c.phone ? <Text className="text-xs" style={{ color: colors.inkMuted }}>{c.phone}</Text> : null}
              </View>
              <View className="flex-row items-center gap-1">
                {connected.has(c.id) ? <Badge label="Connected" variant="success" /> : null}
                {canInvite && c.email && !connected.has(c.id) ? (
                  <Button
                    label="Invite"
                    variant="secondary"
                    size="sm"
                    onPress={() => invite(c)}
                    loading={invitingId === c.id}
                  />
                ) : null}
                {onRemove ? (
                  <Button label="Remove" variant="ghost" size="sm" onPress={() => onRemove(c.id)} />
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
