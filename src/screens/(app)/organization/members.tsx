import { useState } from 'react';
import { Alert, FlatList, Platform, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen, Tabs, Modal } from '@/components/ui';
import { FeatureBlockGate } from '@/components/FeatureBlockGate';
import {
  useOrgMembersQuery,
  useInviteMemberMutation,
  useUpdateMemberRoleMutation,
  useRemoveMemberMutation,
  usePlatformBlockedFeaturesQuery,
} from '@/features/queries';
import { ORG_ROLES, type OrgRole, type OrgMember } from '@/data/types';
import { usePermissions } from '@/state/authStore';

const TABS = [
  { key: 'staff', label: 'Staff' },
  { key: 'guardians', label: 'Guardians' },
];

export default function OrganizationMembersScreen() {
  const colors = useThemeColors();
  const { canManageOrganization } = usePermissions();
  const [tab, setTab] = useState<'staff' | 'guardians'>('staff');
  
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('coach');
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [selectedMemberForRole, setSelectedMemberForRole] = useState<OrgMember | null>(null);

  // `true`: this is the one screen that lists the coaches a club has delegated
  // a single team to, alongside its own staff.
  const { data: members = [], isLoading } = useOrgMembersQuery(true);
  const inviteMut = useInviteMemberMutation();
  const updateRoleMut = useUpdateMemberRoleMutation();
  const removeMut = useRemoveMemberMutation();
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();

  // Matches the helper the team screens use: RN's Alert is a no-op on web,
  // where this app also runs, so every message here has to fall back to the
  // browser dialogs or it never reaches the user at all.
  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') (globalThis as any).alert?.(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  const handleInvite = async () => {
    if (!inviteEmail) return;
    try {
      await inviteMut.mutateAsync({ email: inviteEmail, role: inviteRole });
      showAlert('Success', 'Invitation sent successfully.');
      setInviteEmail('');
    } catch (error: any) {
      showAlert('Invite Failed', error.message || 'Could not invite user.');
    }
  };

  // Removed handleRoleChange since it's now handled by the modal

  /**
   * Removal is permanent and there is no undo — a mis-tapped row on a list
   * this dense would silently cut someone's access — so both the staff
   * Remove and the guardian Revoke confirm first, and surface a failure
   * rather than leaving the row on screen with no explanation.
   */
  const handleRemove = (member: OrgMember) => {
    const who = member.name || member.email;
    const isGuardian = member.role === 'guardian';
    const title = isGuardian ? 'Revoke Access' : 'Remove Member';
    const teams = member.teams?.length ? member.teams.join(', ') : null;

    let message: string;
    if (isGuardian) {
      message = `Revoke ${who}'s access to this organization? They will no longer see their players here.`;
    } else if (member.source === 'teamManager') {
      // Their only access *is* the delegation, so name what they lose.
      message = `Remove ${who} from this organization? They will lose ${teams ? `access to ${teams}` : 'the team delegated to them'}.`;
    } else {
      message = `Remove ${who} from this organization? They will lose access to its teams and evaluations${teams ? `, including ${teams}` : ''}.`;
    }

    const remove = async () => {
      try {
        await removeMut.mutateAsync(member.id);
      } catch (error: any) {
        showAlert(
          isGuardian ? 'Revoke Failed' : 'Remove Failed',
          error?.message || 'Could not remove this member.',
        );
      }
    };

    if (Platform.OS === 'web') {
      if ((globalThis as any).confirm?.(`${title}\n\n${message}`)) void remove();
      return;
    }

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: isGuardian ? 'Revoke' : 'Remove', style: 'destructive', onPress: () => void remove() },
    ]);
  };

  const filteredMembers = members.filter((m) =>
    tab === 'staff' ? m.role !== 'guardian' : m.role === 'guardian',
  );

  if ((platformBlockedFeatures ?? []).includes('organization')) {
    return (
      <Screen scroll={false} padded={false}>
        <View className="px-4">
          <Header title="Manage Organization" showBack />
          <FeatureBlockGate feature="organization" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <View className="px-4">
        <Header title="Manage Organization" showBack />
        <Tabs
          tabs={TABS}
          activeKey={tab}
          onChange={(k) => setTab(k as any)}
          className="mb-4"
        />
      </View>

      {canManageOrganization && tab === 'staff' && (
        <View className="px-4 mb-4">
          <Card className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Invite Staff
            </Text>
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <Input
                  label="Email Address"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              {tab === 'staff' && (
                <Button
                  label={inviteRole.toUpperCase()}
                  variant="secondary"
                  onPress={() => setShowRolePicker(true)}
                />
              )}
            </View>
            <Button
              label="Send Invite"
              onPress={handleInvite}
              loading={inviteMut.isPending}
            />
          </Card>
        </View>
      )}

      <FlatList
        data={filteredMembers}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View className="items-center justify-center py-10 px-4">
            <Text style={{ color: colors.inkMuted, textAlign: 'center' }}>
              {tab === 'staff'
                ? 'No staff members added yet. Invite coaches or evaluators above.'
                : 'No linked guardians found in this organization.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card className="mb-2 flex-row justify-between items-center">
            <View className="flex-1 mr-4">
              <Text className="text-base font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                {item.name || item.email}
              </Text>
              {!!item.name && item.name !== item.email && (
                <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }} numberOfLines={1}>
                  {item.email}
                </Text>
              )}
              <View className="flex-row flex-wrap gap-2 mt-1.5">
                <Badge label={item.role.toUpperCase()} variant="brand" />
                <Badge
                  label={item.status.toUpperCase()}
                  variant={item.status === 'active' ? 'success' : 'warning'}
                />
                {item.source === 'teamManager' ? <Badge label="TEAM MANAGER" variant="info" /> : null}
              </View>
              {item.teams?.length ? (
                <Text className="text-sm mt-1" style={{ color: colors.inkMuted }} numberOfLines={1}>
                  Manages {item.teams.join(', ')}
                </Text>
              ) : null}
            </View>
            {canManageOrganization && item.role !== 'admin' && (
              <View className="flex-row gap-2 items-center">
                {/* A delegated manager has no membership row, so there is no
                    organization role to change, only the team to take back. */}
                {tab === 'staff' && item.source !== 'teamManager' && (
                  <Button
                    label="Role"
                    variant="ghost"
                    size="sm"
                    onPress={() => setSelectedMemberForRole(item)}
                  />
                )}
                <Button
                  label={tab === 'staff' ? 'Remove' : 'Revoke'}
                  variant="danger"
                  size="sm"
                  onPress={() => handleRemove(item)}
                  loading={removeMut.isPending && removeMut.variables === item.id}
                />
              </View>
            )}
          </Card>
        )}
      />

      <Modal
        visible={showRolePicker}
        title="Select Role"
        onClose={() => setShowRolePicker(false)}
        footer={<View />}
      >
        <View className="gap-2">
          {(['coach', 'assessor'] as const).map((r) => (
            <Button
              key={r}
              label={r.toUpperCase()}
              variant={inviteRole === r ? 'primary' : 'ghost'}
              onPress={() => {
                setInviteRole(r);
                setShowRolePicker(false);
              }}
            />
          ))}
        </View>
      </Modal>

      <Modal
        visible={!!selectedMemberForRole}
        title="Update Role"
        onClose={() => setSelectedMemberForRole(null)}
        footer={<View />}
      >
        <View className="gap-2">
          {(['coach', 'assessor'] as const).map((r) => (
            <Button
              key={r}
              label={r.toUpperCase()}
              variant={selectedMemberForRole?.role === r ? 'primary' : 'ghost'}
              onPress={async () => {
                const member = selectedMemberForRole;
                if (!member || member.role === r) {
                  setSelectedMemberForRole(null);
                  return;
                }
                try {
                  await updateRoleMut.mutateAsync({ memberId: member.id, role: r });
                  setSelectedMemberForRole(null);
                  showAlert('Success', `Role updated to ${r.toUpperCase()}.`);
                } catch (error: any) {
                  showAlert('Update Failed', error?.message || 'Could not update role.');
                }
              }}
              loading={updateRoleMut.isPending && selectedMemberForRole?.role !== r}
            />
          ))}
        </View>
      </Modal>
    </Screen>
  );
}
