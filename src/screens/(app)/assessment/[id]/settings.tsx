import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Share, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { MapLink, MapLocationHint } from '@/components/MapLink';
import {
  Badge,
  Button,
  Card,
  DateField,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Modal,
  Screen,
  TimeField,
} from '@/components/ui';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import {
  useTryoutQuery,
  useTryoutSummariesQuery,
  useUpdateTryoutMutation,
  useArchiveTryoutMutation,
  useDeleteTryoutMutation,
  useCopyTryoutMutation,
} from '@/features/queries';
import { getDataSource } from '@/data';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getDefaultRubrics } from '@/data/rubrics';
import { useUser } from '@/state/authStore';
import { isAtAssessmentLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { ASSESSOR_INVITE_URL } from '@/config/app';

/**
 * How an invitation is reading right now, from the inviting coach's side.
 * Spelled out rather than echoing the raw status word: "pending" on its own
 * left the coach unsure whether it meant the email hadn't gone out or the
 * assessor hadn't answered yet.
 */
const INVITE_STATUS: Record<'pending' | 'accepted' | 'declined' | 'completed', {
  label: string;
  variant: 'warning' | 'success' | 'danger';
}> = {
  pending: { label: 'Invite pending', variant: 'warning' },
  accepted: { label: 'Invite accepted', variant: 'success' },
  declined: { label: 'Invite declined', variant: 'danger' },
  completed: { label: 'Assessing complete', variant: 'success' },
};

export default function SettingsScreen() {
  const id = useAssessmentId();
  const route = useRoute<any>();
  const { welcome } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const welcomedRef = useRef(false);
  const tryoutQuery = useTryoutQuery(id);
  // Only `.length` is read from this, for the plan-limit check — the full
  // read pulled every roster, evaluation and registration in the account to
  // get a number. See useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const updateTryout = useUpdateTryoutMutation();
  const archiveTryout = useArchiveTryoutMutation();
  const deleteTryout = useDeleteTryoutMutation();
  const copyTryout = useCopyTryoutMutation();
  const [showRubrics, setShowRubrics] = useState(false);
  const [showAssessor, setShowAssessor] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [assessorName, setAssessorName] = useState('');
  const [assessorEmail, setAssessorEmail] = useState('');
  const [name, setName] = useState('');
  const [tryoutDate, setTryoutDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [rink, setRink] = useState('');
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  useEffect(() => {
    if (welcome === '1' && !welcomedRef.current) {
      welcomedRef.current = true;
      setShowAssessor(true);
    }
  }, [welcome]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading settings..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load settings." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const rubrics = getDefaultRubrics(tryout.sport);

  const openEdit = () => {
    setName(tryout.name);
    setTryoutDate(tryout.tryoutDate ?? '');
    setStartTime(tryout.startTime ?? '');
    setEndTime(tryout.endTime ?? '');
    setRink(tryout.rink ?? '');
    setShowEdit(true);
  };

  const saveEdit = async () => {
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        name: name.trim() || tryout.name,
        tryoutDate: tryoutDate.trim() || undefined,
        startTime: startTime.trim() || undefined,
        endTime: endTime.trim() || undefined,
        rink: rink.trim() || undefined,
      },
    });
    setShowEdit(false);
  };

  // The invite is claimed by email address, not by a token in the URL: the
  // database links a tryout_assessors row to whoever signs in with the address
  // it was addressed to (link_assessor_to_user on insert, handle_new_user on
  // signup). So the link only has to land the invitee on the sign-in screen —
  // it deliberately carries no identifying details.
  const shareAssessorInvite = async (assessor: { name: string; email?: string }) => {
    const link = `${ASSESSOR_INVITE_URL}`;

    if (assessor.email) {
      try {
        await getDataSource().sendEmail('tryout_invite', assessor.email, {
          role: 'assessor',
          tryoutName: tryout.name,
          inviteUrl: link,
        });
        Alert.alert(
          'Invitation Sent',
          `An invitation email has been sent to ${assessor.email}. They can accept it after signing in — or after creating an account with that address if they don't have one yet.`,
        );
        return;
      } catch (err: any) {
        console.error('Error sending email via Supabase', err);
        Alert.alert('Email Failed', 'Could not send the email automatically. Falling back to share menu.');
      }
    }

    await Share.share({
      message: `${assessor.name}, you've been invited to score ${tryout.name}. Sign in (or create an account) with this email address to accept.\nOpen: ${link}`,
    });
  };

  const addAssessor = async () => {
    if (!assessorName.trim()) return;
    
    const emailToInvite = assessorEmail.trim();

    if (!emailToInvite) {
      Alert.alert('Email Required', 'You must provide a valid email address for the assessor.');
      return;
    }

    // One row per address per tryout is a database constraint
    // (unique (tryout_id, email)), so catch the repeat here and say so rather
    // than letting the insert fail with a Postgres message.
    if (tryout.assessors.some((a: any) => a.email?.toLowerCase() === emailToInvite.toLowerCase())) {
      Alert.alert('Already Invited', `${emailToInvite} is already on this evaluation's assessor list.`);
      return;
    }

    // Wrapped because none of this was: a failing updateTryout threw straight
    // past setShowAssessor(false) as an unhandled rejection, so the modal just
    // sat there with no error and no visible reason — which reads as "the modal
    // won't close". It deliberately stays open on failure so the entry can be
    // corrected and retried; what was missing was saying why.
    try {
      // No "do they already have an account?" gate. An invite is addressed to
      // an email, and the database claims it for whoever signs up with that
      // address (handle_new_user in 0002_assessor_linking.sql), so requiring
      // the assessor to go and register first — with no prompt telling them to
      // — was a dead end the coach had no way past.
      const newAssessor = { name: assessorName.trim(), email: emailToInvite, role: 'assessor' as const, status: 'pending' as const };

      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          assessors: [
            ...tryout.assessors,
            newAssessor,
          ],
        },
      });
      setAssessorName('');
      setAssessorEmail('');
      setShowAssessor(false);

      if (newAssessor.email) {
        await shareAssessorInvite(newAssessor);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add this assessor.');
    }
  };

  const sendReminder = async (assessor: any) => {
    if (!assessor.email) {
      Alert.alert('No Email', 'This assessor does not have an email address attached.');
      return;
    }
    try {
      await getDataSource().sendEmail('reminder', assessor.email, {
        title: tryout.name,
        message: `This is a reminder that you have been assigned to assess players for ${tryout.name}. Please log in to complete your evaluations.`,
      });
      Alert.alert('Reminder Sent', `Reminder successfully sent to ${assessor.name}.`);
    } catch (e: any) {
      Alert.alert('Reminder Failed', e.message || 'Could not send reminder.');
    }
  };

  const removeAssessor = async (index: number) => {
    const newAssessors = [...tryout.assessors];
    newAssessors.splice(index, 1);
    try {
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          assessors: newAssessors,
        },
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not remove this assessor.');
    }
  };

  const handleCopy = async () => {
    const count = tryoutsQuery.data?.length ?? 0;
    if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'assessments', 'evaluations'));
      return;
    }
    const copy = await copyTryout.mutateAsync(tryout.id);
    navigation.navigate('AssessmentRoster', { id: copy.id });
  };

  const handleArchive = async () => {
    await archiveTryout.mutateAsync(tryout.id);
    navigation.replace('DashboardMain');
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Evaluation',
      'Are you sure you want to delete this evaluation? This action cannot be undone and will delete all associated data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTryout.mutateAsync(tryout.id);
            navigation.replace('DashboardMain');
          },
        },
      ]
    );
  };

  return (
    <Screen scroll insideTabBar>
      <Header title="Evaluation Settings" showBack />
      <Card accent className="mb-4 gap-2">
        <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
          {tryout.name}
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          {tryout.sport} · {tryout.eventType}
        </Text>
        {tryout.tryoutDate ? (
          <Text style={{ color: colors.inkFaint }}>
            {tryout.tryoutDate}{' '}
            {tryout.startTime ? `· ${tryout.startTime}${tryout.endTime ? `–${tryout.endTime}` : ''}` : ''}
            {tryout.rink ? (
              <>
                {' · '}
                <MapLink location={tryout.rink} label={tryout.name} variant="inline" />
              </>
            ) : null}
          </Text>
        ) : null}
        {tryout.cloud?.id ? <Badge label={`Code: ${tryout.cloud.id}`} variant="brand" /> : null}
        <Button label="Edit Details" variant="secondary" size="sm" onPress={openEdit} />
      </Card>

      <Card className="mb-4 gap-3">
        <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
          Assessors ({tryout.assessors.length})
        </Text>
        {tryout.assessors.map((a, i) => (
          <View key={i} className="py-2 mb-2 border-b border-white/5 flex-col gap-2">
            <View className="flex-row justify-between items-start">
              <View className="flex-1 pr-2">
                <Text className="text-base font-bold" style={{ color: colors.ink }}>{a.name}</Text>
                {a.email ? (
                  <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>
                    {a.email}
                  </Text>
                ) : null}
                <View className="flex-row gap-1 mt-2">
                  {a.role !== 'lead' ? (
                    <Badge
                    label={INVITE_STATUS[a.status ?? 'pending'].label}
                    variant={INVITE_STATUS[a.status ?? 'pending'].variant}
                  />
                  ) : null}
                  <Badge label={a.role} />
                </View>
              </View>
              
              {a.role !== 'lead' ? (
                <View className="flex-col gap-2 items-end">
                  <Button label={a.status === 'pending' ? 'Resend Invite' : 'Send Reminder'} size="sm" variant="secondary" onPress={() => {
                    if (a.status === 'pending') shareAssessorInvite(a);
                    else sendReminder(a);
                  }} />
                  <Button label="Remove" size="sm" variant="ghost" onPress={() => removeAssessor(i)} />
                </View>
              ) : null}
            </View>
          </View>
        ))}
        <Button label="+ Add Assessor" variant="secondary" size="sm" onPress={() => setShowAssessor(true)} />
      </Card>

      <Card className="mb-4 gap-2">
        <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
          Rubrics
        </Text>
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          {rubrics.skater.length} skater + {rubrics.goalie.length} goalie categories
        </Text>
        <Button label="Open Rubric Builder" variant="secondary" size="sm" onPress={() => navigation.navigate('AssessmentRubrics', { id: id })} />
        <Button label="View Reference" variant="ghost" size="sm" onPress={() => setShowRubrics(true)} />
      </Card>

      <Card className="mb-4 gap-2">
        <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
          Duplicate
        </Text>
        <Button label="Copy Evaluation" variant="secondary" onPress={handleCopy} loading={copyTryout.isPending} />
      </Card>

      <Card className="mb-4 gap-2">
        <Text className="text-md font-display font-bold" style={{ color: colors.danger }}>
          Danger Zone
        </Text>
        <Button label="Archive Evaluation" variant="danger" onPress={handleArchive} loading={archiveTryout.isPending} />
        <Button label="Delete Evaluation" variant="danger" onPress={handleDelete} loading={deleteTryout.isPending} />
      </Card>

      <Modal visible={showEdit} title="Edit Evaluation" onClose={() => setShowEdit(false)}>
        <View className="gap-3">
          <Input label="Name" value={name} onChangeText={setName} />
          <DateField label="Date" value={tryoutDate} onChange={setTryoutDate} placeholder="Select a date" />
          <TimeField label="Start Time" value={startTime} onChange={setStartTime} placeholder="Select a time" />
          <TimeField label="End Time" value={endTime} onChange={setEndTime} placeholder="Select a time" />
          <View>
            <Input
              label="Location"
              value={rink}
              onChangeText={setRink}
              placeholder="Field A, 55 Bloor St W, Toronto"
            />
            <MapLocationHint location={rink} />
          </View>
          <Button label="Save" onPress={saveEdit} loading={updateTryout.isPending} />
        </View>
      </Modal>

      {/* No ScrollView here — Modal already scrolls its children. An unbounded
          one nested inside that collapses and clips the tail of the content. */}
      <Modal visible={showRubrics} title="Rubric Reference" onClose={() => setShowRubrics(false)}>
        <>
          <Text className="text-sm font-bold mb-2" style={{ color: colors.primary }}>
            Skater Categories
          </Text>
          {rubrics.skater.map((r) => (
            <View key={r.key} className="mb-2">
              <Text className="text-base" style={{ color: colors.ink }}>
                {r.label}
              </Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {r.subskills.map((s) => s.label).join(', ')}
              </Text>
            </View>
          ))}
          {rubrics.goalie.length > 0 ? (
            <>
              <Text className="text-sm font-bold mt-4 mb-2" style={{ color: colors.primary }}>
                Goalie Categories
              </Text>
              {rubrics.goalie.map((r) => (
                <View key={r.key} className="mb-2">
                  <Text className="text-base" style={{ color: colors.ink }}>
                    {r.label}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {r.subskills.map((s) => s.label).join(', ')}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </>
      </Modal>

      <Modal visible={showAssessor} title="Add Assessor" onClose={() => setShowAssessor(false)}>
        <View className="gap-3">
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            They'll get an email invitation. If they don't have a TryoutHQ account yet, they can create one with this
            address and the invitation will be waiting for them.
          </Text>
          <Input label="Name" value={assessorName} onChangeText={setAssessorName} />
          <Input label="Email (Required)" value={assessorEmail} onChangeText={setAssessorEmail} autoCapitalize="none" />
          <Button label="Add" onPress={addAssessor} loading={updateTryout.isPending} />
        </View>
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
