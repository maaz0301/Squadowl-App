import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { BirthDateField, Button, Card, Input, Modal, PhoneField } from '@/components/ui';
import { PlayerFamilyContactsCard } from '@/components/assessment/PlayerFamilyContactsCard';
import {
  useAddFamilyContactMutation,
  useGuardianAthleteInfoQuery,
  useRemoveFamilyContactMutation,
  useUpdateGuardianAthleteMutation,
} from '@/features/queries';
import { formatBirth } from '@/lib/birthDate';
import { useThemeColors } from '@/theme/ThemeProvider';

function Row({ label, value, last }: { label: string; value?: string; last?: boolean }) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row justify-between gap-3 py-2"
      style={last ? undefined : { borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <Text style={{ color: colors.inkMuted }}>{label}</Text>
      <Text className="font-medium flex-1 text-right" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '-'}
      </Text>
    </View>
  );
}

/**
 * The guardian portal's Info tab: the athlete's details, which the guardian can
 * edit, and the extra family members they keep on the profile.
 */
export function GuardianAthleteInfo({
  athleteId,
  firstName,
  lastName,
}: {
  athleteId: string;
  firstName: string;
  lastName: string;
}) {
  const colors = useThemeColors();
  const profileQuery = useGuardianAthleteInfoQuery(athleteId);
  const profile = profileQuery.data;
  const updateAthlete = useUpdateGuardianAthleteMutation(athleteId);
  const addContact = useAddFamilyContactMutation(athleteId);
  const removeContact = useRemoveFamilyContactMutation(athleteId);

  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState({
    first: '',
    last: '',
    yearOfBirth: '',
    dateOfBirth: '',
    playerEmail: '',
    guardianName: '',
    guardianPhone: '',
    medicalInfo: '',
    aboutChild: '',
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [showAddContact, setShowAddContact] = useState(false);
  const [contact, setContact] = useState({ name: '', relationship: '', email: '', phone: '' });

  const openEdit = () => {
    setForm({
      first: profile?.first ?? firstName,
      last: profile?.last ?? lastName,
      yearOfBirth: profile?.yearOfBirth ?? '',
      dateOfBirth: profile?.dateOfBirth ?? '',
      playerEmail: profile?.playerEmail ?? '',
      guardianName: profile?.guardianName ?? '',
      guardianPhone: profile?.guardianPhone ?? '',
      medicalInfo: profile?.medicalInfo ?? '',
      aboutChild: profile?.aboutChild ?? '',
    });
    setShowEdit(true);
  };

  const save = async () => {
    if (!form.first.trim() || !form.last.trim()) {
      Alert.alert('Missing Info', 'First and last name are required.');
      return;
    }
    try {
      await updateAthlete.mutateAsync({
        first: form.first,
        last: form.last,
        yearOfBirth: form.yearOfBirth,
        dateOfBirth: form.dateOfBirth,
        playerEmail: form.playerEmail,
        guardianName: form.guardianName,
        guardianPhone: form.guardianPhone,
        medicalInfo: form.medicalInfo,
        aboutChild: form.aboutChild,
      });
      setShowEdit(false);
      void profileQuery.refetch();
    } catch (e: any) {
      Alert.alert('Could Not Save', e?.message || 'Something went wrong.');
    }
  };

  const submitContact = async () => {
    if (!contact.name.trim()) {
      Alert.alert('Missing Info', 'Enter at least a name.');
      return;
    }
    try {
      await addContact.mutateAsync({
        name: contact.name.trim(),
        relationship: contact.relationship.trim() || undefined,
        email: contact.email.trim() || undefined,
        phone: contact.phone.trim() || undefined,
      });
      setContact({ name: '', relationship: '', email: '', phone: '' });
      setShowAddContact(false);
    } catch (e: any) {
      Alert.alert('Could Not Add', e?.message || 'Something went wrong.');
    }
  };

  return (
    <View className="px-4">
      <Card className="mb-3">
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-lg font-bold" style={{ color: colors.ink }}>
            Player Information
          </Text>
          <Button label="Edit" size="sm" variant="secondary" onPress={openEdit} />
        </View>
        <Row label="First Name" value={profile?.first ?? firstName} />
        <Row label="Last Name" value={profile?.last ?? lastName} />
        <Row label="Date of Birth" value={profile ? formatBirth(profile.dateOfBirth, profile.yearOfBirth) : undefined} />
        <Row label="Player Email" value={profile?.playerEmail} />
        <Row label="Guardian" value={profile?.guardianName} />
        <Row label="Guardian Email" value={profile?.guardianEmail} />
        <Row label="Guardian Phone" value={profile?.guardianPhone} />
        <Row label="Medical" value={profile?.medicalInfo} last />
      </Card>

      <PlayerFamilyContactsCard
        athleteId={athleteId}
        athleteName={`${firstName} ${lastName}`}
        guardianEmail={profile?.guardianEmail}
        canInvite={false}
        onRemove={(id) =>
          Alert.alert('Remove Family Member', 'Remove this person from the profile?', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () =>
                removeContact.mutate(id, {
                  onError: (e: any) => Alert.alert('Could Not Remove', e?.message || 'Something went wrong.'),
                }),
            },
          ])
        }
      />
      <Button label="Add Family Member" variant="secondary" onPress={() => setShowAddContact(true)} className="mb-3" />

      <Card>
        <Text className="text-lg font-bold mb-2" style={{ color: colors.ink }}>
          Account Link
        </Text>
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          This athlete is linked to your guardian account. You will receive notifications and updates regarding their seasons and team events.
        </Text>
      </Card>

      <Modal
        visible={showEdit}
        title="Edit Player"
        onClose={() => {
          if (!updateAthlete.isPending) setShowEdit(false);
        }}
      >
        <View className="gap-3">
          <Input label="First Name" value={form.first} onChangeText={set('first')} />
          <Input label="Last Name" value={form.last} onChangeText={set('last')} />
          <BirthDateField
            label="Date of Birth"
            year={form.yearOfBirth}
            dateOfBirth={form.dateOfBirth}
            onChange={({ year, dateOfBirth }) => setForm((f) => ({ ...f, yearOfBirth: year, dateOfBirth }))}
          />
          <Input
            label="Player Email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={form.playerEmail}
            onChangeText={set('playerEmail')}
          />
          <Input label="Guardian Name" value={form.guardianName} onChangeText={set('guardianName')} />
          <PhoneField label="Guardian Phone" value={form.guardianPhone} onChange={set('guardianPhone')} />
          <Input label="Medical Info" value={form.medicalInfo} onChangeText={set('medicalInfo')} multiline />
          <Input label="About (optional note for the coach)" value={form.aboutChild} onChangeText={set('aboutChild')} multiline />
          <Button label="Save" onPress={save} loading={updateAthlete.isPending} />
        </View>
      </Modal>

      <Modal
        visible={showAddContact}
        title="Add Family Member"
        onClose={() => {
          if (!addContact.isPending) setShowAddContact(false);
        }}
      >
        <View className="gap-3">
          <Input label="Name" value={contact.name} onChangeText={(v) => setContact((c) => ({ ...c, name: v }))} />
          <Input
            label="Relationship"
            value={contact.relationship}
            onChangeText={(v) => setContact((c) => ({ ...c, relationship: v }))}
            placeholder="e.g. Parent, Grandmother, Emergency Contact"
          />
          <Input
            label="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={contact.email}
            onChangeText={(v) => setContact((c) => ({ ...c, email: v }))}
          />
          <Input label="Phone" value={contact.phone} onChangeText={(v) => setContact((c) => ({ ...c, phone: v }))} />
          <Button label="Add" onPress={submitContact} loading={addContact.isPending} disabled={!contact.name.trim()} />
        </View>
      </Modal>
    </View>
  );
}
