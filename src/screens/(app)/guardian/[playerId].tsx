import React, { useState } from 'react';
import { FlatList, View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useQueryClient } from '@tanstack/react-query';
import {
  Screen,
  Header,
  Card,
  Tabs,
  Avatar,
  EmptyState,
  LoadingState,
  ErrorState,
  Badge,
  Button,
  Modal,
  Input,
} from '@/components/ui';
import { ChatIconButton } from '@/components/ChatIconButton';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  useGuardianRostersQuery,
  useGuardianRealtimeSync,
  useSetAvailabilityMutation,
  useCreateTeamFeePaymentMutation,
  useFamilyContactsQuery,
  useAddFamilyContactMutation,
  useRemoveFamilyContactMutation,
  useLeaveSeasonMutation,
} from '@/features/queries';
import { queryKeys } from '@/lib/queryClient';
import { useAuthStore } from '@/state/authStore';
import type { SeasonEvent } from '@/data/types';

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ExpandableText({ text, style, className }: { text: string, style?: any, className?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <Text className={className} style={style} numberOfLines={expanded ? undefined : 1}>
        {text}
      </Text>
    </Pressable>
  );
}

function EventCard({ item, playerId, colors }: { item: SeasonEvent & { seasonName: string; teamName: string; seasonId: string }, playerId: string, colors: any }) {
  const rsvpMutation = useSetAvailabilityMutation(item.seasonId);
  const rsvp = item.availability?.[playerId] || 'pending';

  const handleRsvp = async (response: 'yes' | 'maybe' | 'no') => {
    try {
      await rsvpMutation.mutateAsync({ eventId: item.id, playerId, response });
    } catch (error: any) {
      Alert.alert('RSVP Failed', error.message || 'Could not save your response.');
    }
  };

  return (
    <Card className="mb-3">
      <View className="flex-row justify-between items-start mb-2">
          <View className="flex-1 mr-2">
            <Text className="text-base font-bold" style={{ color: colors.ink }}>
              {item.title}
            </Text>
            <ExpandableText text={item.seasonName} className="text-sm" style={{ color: colors.primary }} />
          </View>
        <Badge label={item.type} variant="info" />
      </View>
      
      <View className="flex-row items-center gap-2 mt-1">
        <Text className="text-sm font-medium" style={{ color: colors.inkMuted }}>
          📅 {item.date}
        </Text>
        {(item.startTime || item.endTime) && (
          <Text className="text-sm font-medium" style={{ color: colors.inkMuted }}>
            · 🕒 {item.startTime} {item.endTime ? `- ${item.endTime}` : ''}
          </Text>
        )}
      </View>
      {item.location ? (
        <Text className="text-sm font-medium mt-1" style={{ color: colors.inkMuted }}>
          📍 {item.location}
        </Text>
      ) : null}

      <View className="mt-4 pt-3 border-t" style={{ borderTopColor: colors.border }}>
        <Text className="text-sm font-bold mb-2" style={{ color: colors.inkMuted }}>RSVP</Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => handleRsvp('yes')}
            className="flex-1 py-2 items-center rounded-md"
            style={{ backgroundColor: rsvp === 'yes' ? colors.success : colors.tile }}
          >
            <Text className="font-bold" style={{ color: rsvp === 'yes' ? '#fff' : colors.ink }}>Yes</Text>
          </Pressable>
          <Pressable
            onPress={() => handleRsvp('maybe')}
            className="flex-1 py-2 items-center rounded-md"
            style={{ backgroundColor: rsvp === 'maybe' ? colors.warning : colors.tile }}
          >
            <Text className="font-bold" style={{ color: rsvp === 'maybe' ? '#fff' : colors.ink }}>Maybe</Text>
          </Pressable>
          <Pressable
            onPress={() => handleRsvp('no')}
            className="flex-1 py-2 items-center rounded-md"
            style={{ backgroundColor: rsvp === 'no' ? colors.error : colors.tile }}
          >
            <Text className="font-bold" style={{ color: rsvp === 'no' ? '#fff' : colors.ink }}>No</Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

import { useNavigation } from '@react-navigation/native';

function TryoutSeasonCard({ item, colors, playerId }: { item: any; colors: any; playerId: string }) {
  const navigation = useNavigation<any>();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user?.id);
  const payFeeMutation = useCreateTeamFeePaymentMutation();
  const leaveSeasonMutation = useLeaveSeasonMutation();
  const [paying, setPaying] = useState(false);

  const confirmLeave = () => {
    Alert.alert(
      'Leave Team',
      `Remove this athlete from ${item.teamName ?? 'this team'} (${item.name})? You'll need a new invite to rejoin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            leaveSeasonMutation.mutate(item.seasonRosterId, {
              onError: (e: any) =>
                Alert.alert('Could Not Leave', e?.message || 'Something went wrong.'),
            });
          },
        },
      ]
    );
  };

  const payFee = async () => {
    try {
      setPaying(true);
      const res = await payFeeMutation.mutateAsync({ seasonRosterId: item.seasonRosterId });
      if (!res?.url) return;

      if (await InAppBrowser.isAvailable()) {
        await InAppBrowser.openAuth(res.url, 'aastryout://guardian', {
          dismissButtonStyle: 'cancel',
          preferredBarTintColor: colors.bg,
          preferredControlTintColor: colors.primary,
          modalPresentationStyle: 'fullScreen',
        });
      } else {
        const { Linking } = require('react-native');
        await Linking.openURL(res.url);
      }

      // Stripe's checkout.session.completed webhook lands a moment after the
      // guardian pays, so poll a few times instead of assuming it's instant.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await qc.refetchQueries({ queryKey: queryKeys.guardianRosters(userId) });
        const refreshed = qc.getQueryData<any[]>(queryKeys.guardianRosters(userId));
        const athlete = refreshed?.find((a) => a.id === playerId);
        const season = athlete?.seasons?.find((s: any) => s.seasonRosterId === item.seasonRosterId);
        if (season?.feeStatus === 'paid') break;
      }
    } catch (err: any) {
      Alert.alert('Payment Error', err.message || 'Something went wrong.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <Pressable onPress={() => {
      if (item._type === 'tryout') {
        navigation.navigate('GuardianAssessmentDetails', { playerId, tryoutId: item.id });
      }
    }}>
      <Card accent className="mb-3">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 mr-2">
            <ExpandableText text={item.name} className="text-lg font-display font-bold mb-1" style={{ color: colors.ink }} />
            {item._type === 'season' ? (
              <Text className="text-sm mb-2" style={{ color: colors.inkMuted }}>
                Team: {item.teamName} · {item.sport}
              </Text>
            ) : (
              <Text className="text-sm mb-2" style={{ color: colors.inkMuted }}>
                Evaluation · {item.sport}
              </Text>
            )}
          </View>
          <Badge label={item._type === 'season' ? 'Team' : 'Evaluation'} variant={item._type === 'season' ? 'info' : 'brand'} />
        </View>

        {item._type === 'season' && item.collectsFees ? (
          <View className="mt-3 pt-3 border-t flex-row items-center justify-between" style={{ borderTopColor: colors.border }}>
            <Text className="text-sm font-bold" style={{ color: colors.ink }}>
              Team fee: {money(item.registrationFeeCents ?? 0)}
            </Text>
            {item.feeStatus === 'unpaid' ? (
              <Button label="Pay Now" size="sm" loading={paying} onPress={payFee} />
            ) : (
              <Badge label={item.feeStatus === 'waived' ? 'Waived' : 'Paid'} variant="success" />
            )}
          </View>
        ) : null}

        {item._type === 'season' ? (
          <View
            className="mt-3 pt-3 border-t items-end"
            style={{ borderTopColor: colors.border }}
          >
            <Button
              label="Leave Team"
              size="sm"
              variant="ghost"
              textClassName="text-danger"
              loading={leaveSeasonMutation.isPending}
              onPress={confirmLeave}
            />
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function GuardianPortalScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const playerId = route.params?.playerId;
  const colors = useThemeColors();
  const [tab, setTab] = useState('overview');
  // Only shown when the athlete is on more than one team — with just one,
  // the chat icon skips straight to it.
  const [chatPickerOpen, setChatPickerOpen] = useState(false);

  const guardianQuery = useGuardianRostersQuery();
  // Keeps this screen in sync with a coach's event edits without needing to
  // navigate away and back for the cache to refresh.
  useGuardianRealtimeSync();

  const familyContactsQuery = useFamilyContactsQuery(playerId);
  const addFamilyContact = useAddFamilyContactMutation(playerId);
  const removeFamilyContact = useRemoveFamilyContactMutation(playerId);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const submitFamilyContact = async () => {
    if (!contactName.trim()) {
      Alert.alert('Missing Info', 'Enter at least a name.');
      return;
    }
    try {
      await addFamilyContact.mutateAsync({
        name: contactName.trim(),
        relationship: contactRelationship.trim() || undefined,
        email: contactEmail.trim() || undefined,
        phone: contactPhone.trim() || undefined,
      });
      setContactName('');
      setContactRelationship('');
      setContactEmail('');
      setContactPhone('');
      setShowAddContact(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add this contact.');
    }
  };

  const confirmRemoveContact = (id: string, name: string) => {
    Alert.alert('Remove Contact', `Remove ${name} from this athlete's family contacts?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeFamilyContact.mutate(id),
      },
    ]);
  };

  if (guardianQuery.isLoading) {
    return <LoadingState message="Loading portal..." />;
  }

  if (guardianQuery.isError) {
    return <ErrorState message="Failed to load player details." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a) => a.id === playerId);

  if (!athlete) {
    return (
      <Screen>
        <Header title="Guardian Portal" showBack />
        <EmptyState title="Player not found" message="We couldn't find this player in your roster." />
      </Screen>
    );
  }

  // Aggregate events from the seasons the athlete is enrolled in
  let allEvents: (SeasonEvent & { seasonName: string; teamName: string; seasonId: string })[] = [];
  
  if (athlete && athlete.seasons) {
    athlete.seasons.forEach((season) => {
      const seasonEvents: SeasonEvent[] = (season as any).events || [];
      seasonEvents.forEach((event) => {
        allEvents.push({
          ...event,
          seasonName: season.name,
          teamName: season.teamName,
          seasonId: season.id,
        });
      });
    });
    
    // Sort chronologically (assuming event.date is ISO string or YYYY-MM-DD)
    allEvents.sort((a, b) => {
      const aDate = new Date(`${a.date}T${a.startTime || '00:00'}`).getTime();
      const bDate = new Date(`${b.date}T${b.startTime || '00:00'}`).getTime();
      return aDate - bDate;
    });
  }

  // Shared by the header icon and the multi-team picker below.
  const openTeamChat = (season: (typeof athlete.seasons)[number]) => {
    setChatPickerOpen(false);
    navigation.navigate('TeamChat', {
      seasonId: season.id,
      title: `${season.teamName} Chat`,
      subtitle: season.name,
      noSeasonMessage:
        'This athlete has not been added to a team yet. Once a coach adds them to a roster, the team chat opens up here.',
    });
  };
  const openChat = () => {
    if (athlete.seasons.length === 1) {
      openTeamChat(athlete.seasons[0]);
    } else {
      setChatPickerOpen(true);
    }
  };

  return (
    <Screen padded={false}>
      <View className="px-4 pb-2">
        <Header
          title="Guardian Portal"
          showBack
          right={
            <View className="flex-row items-center gap-2">
              <ChatIconButton onPress={openChat} />
              <Button
                label="Share"
                size="sm"
                variant="secondary"
                onPress={() => navigation.navigate('ShareDirectory', { athleteId: playerId })}
              />
            </View>
          }
        />

        <View className="flex-row items-center gap-4 mb-4 mt-2">
          <Avatar first={athlete.firstName} last={athlete.lastName} size={64} uri={athlete.avatarUrl} />
          <View>
            <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
              {athlete.firstName} {athlete.lastName}
            </Text>
            <Text className="text-base mt-1" style={{ color: colors.inkMuted }}>
              {athlete.seasons.length} Active Assignments
            </Text>
          </View>
        </View>

        <Tabs
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'schedule', label: 'Schedule', badge: allEvents.length || undefined },
            { key: 'info', label: 'Info' },
          ]}
          activeKey={tab}
          onChange={setTab}
          className="mb-4"
        />
      </View>

      {tab === 'overview' ? (
        <FlatList
          data={athlete.seasons.map((s) => ({ ...s, _type: 'season' as const }))}
          keyExtractor={(item) => `${item._type}-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              title="No assignments"
              message="This athlete isn't assigned to any seasons yet."
            />
          }
          renderItem={({ item }) => <TryoutSeasonCard item={item} colors={colors} playerId={playerId} />}
        />
      ) : tab === 'schedule' ? (
        <FlatList
          data={allEvents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              title="No events scheduled"
              message="There are no upcoming events for this athlete."
            />
          }
          renderItem={({ item }) => <EventCard item={item} playerId={playerId} colors={colors} />}
        />
      ) : (
        <View className="px-4">
          <Card className="mb-3">
            <Text className="text-lg font-bold mb-2" style={{ color: colors.ink }}>
              Basic Information
            </Text>
            <View className="flex-row justify-between py-2 border-b" style={{ borderBottomColor: colors.border }}>
              <Text style={{ color: colors.inkMuted }}>First Name</Text>
              <Text className="font-medium" style={{ color: colors.ink }}>{athlete.firstName}</Text>
            </View>
            <View className="flex-row justify-between py-2">
              <Text style={{ color: colors.inkMuted }}>Last Name</Text>
              <Text className="font-medium" style={{ color: colors.ink }}>{athlete.lastName}</Text>
            </View>
          </Card>

          <Card className="mb-3">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-lg font-bold" style={{ color: colors.ink }}>
                Family Contacts
              </Text>
              <Button label="+ Add" size="sm" variant="ghost" onPress={() => setShowAddContact(true)} />
            </View>
            <Text className="text-xs mb-2" style={{ color: colors.inkMuted }}>
              Other family members — a second parent, a grandparent, an emergency contact.
            </Text>
            {familyContactsQuery.isLoading ? (
              <ActivityIndicator />
            ) : (familyContactsQuery.data ?? []).length === 0 ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                No additional contacts added yet.
              </Text>
            ) : (
              (familyContactsQuery.data ?? []).map((c) => (
                <View
                  key={c.id}
                  className="flex-row items-center justify-between py-2 border-b"
                  style={{ borderBottomColor: colors.border }}
                >
                  <View className="flex-1 mr-2">
                    <Text className="font-medium" style={{ color: colors.ink }}>
                      {c.name}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </Text>
                    {c.email ? (
                      <Text className="text-xs" style={{ color: colors.inkMuted }}>{c.email}</Text>
                    ) : null}
                    {c.phone ? (
                      <Text className="text-xs" style={{ color: colors.inkMuted }}>{c.phone}</Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => confirmRemoveContact(c.id, c.name)} hitSlop={8}>
                    <Text style={{ color: colors.danger, fontSize: 18, fontWeight: 'bold' }}>✕</Text>
                  </Pressable>
                </View>
              ))
            )}
          </Card>

          <Card>
             <Text className="text-lg font-bold mb-2" style={{ color: colors.ink }}>
              Account Link
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              This athlete is linked to your guardian account. You will receive notifications and updates regarding their tryouts and team events.
            </Text>
          </Card>
        </View>
      )}

      <Modal visible={chatPickerOpen} title="Choose a Team" onClose={() => setChatPickerOpen(false)}>
        <View style={{ gap: 2 }}>
          {athlete.seasons.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => openTeamChat(s)}
              style={({ pressed }) => [
                {
                  padding: 12,
                  backgroundColor: pressed ? colors.border : 'transparent',
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <Text className="font-bold" style={{ color: colors.ink }}>{s.teamName}</Text>
              <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>

      <Modal
        visible={showAddContact}
        title="Add Family Contact"
        onClose={() => {
          if (addFamilyContact.isPending) return;
          setShowAddContact(false);
        }}
        footer={
          <View className="mt-4">
            <Button
              label="Add Contact"
              onPress={submitFamilyContact}
              loading={addFamilyContact.isPending}
              disabled={!contactName.trim()}
            />
          </View>
        }
      >
        <View className="gap-3">
          <Input label="Name" value={contactName} onChangeText={setContactName} />
          <Input
            label="Relationship"
            value={contactRelationship}
            onChangeText={setContactRelationship}
            placeholder="e.g. Grandmother, Emergency Contact"
          />
          <Input label="Email" value={contactEmail} onChangeText={setContactEmail} autoCapitalize="none" keyboardType="email-address" />
          <Input label="Phone" value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" />
        </View>
      </Modal>
    </Screen>
  );
}
