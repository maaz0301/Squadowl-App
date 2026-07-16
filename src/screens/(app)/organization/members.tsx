import { useState } from 'react';
import { FlatList, Text, View, Alert } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen, Tabs, Modal } from '@/components/ui';
import {
  useOrgMembersQuery,
  useInviteMemberMutation,
  useUpdateMemberRoleMutation,
  useRemoveMemberMutation,
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

  const { data: members = [], isLoading } = useOrgMembersQuery();
  const inviteMut = useInviteMemberMutation();
  const updateRoleMut = useUpdateMemberRoleMutation();
  const removeMut = useRemoveMemberMutation();

  const handleInvite = async () => {
    if (!inviteEmail) return;
    try {
      await inviteMut.mutateAsync({ email: inviteEmail, role: inviteRole });
      Alert.alert('Success', 'Invitation sent successfully.');
      setInviteEmail('');
    } catch (error: any) {
      Alert.alert('Invite Failed', error.message || 'Could not invite user.');
    }
  };

  // Removed handleRoleChange since it's now handled by the modal

  const handleRemove = async (memberId: string) => {
    await removeMut.mutateAsync(memberId);
  };

  const filteredMembers = members.filter((m) =>
    tab === 'staff' ? m.role !== 'guardian' : m.role === 'guardian',
  );

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
          <View className="items-center justify-center py-10">
            <Text style={{ color: colors.inkMuted }}>
              No {tab} members found.
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
              <View className="flex-row gap-2 mt-1.5">
                <Badge label={item.role.toUpperCase()} variant="brand" />
                <Badge
                  label={item.status.toUpperCase()}
                  variant={item.status === 'active' ? 'success' : 'warning'}
                />
              </View>
            </View>
            {canManageOrganization && item.role !== 'admin' && (
              <View className="flex-row gap-2 items-center">
                {tab === 'staff' && (
                  <Button
                    label="Role"
                    variant="ghost"
                    size="sm"
                    onPress={() => setSelectedMemberForRole(item)}
                  />
                )}
                <Button
                  label="Revoke"
                  variant="danger"
                  size="sm"
                  onPress={() => handleRemove(item.id)}
                  loading={removeMut.isPending}
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
          {(['admin', 'coach', 'assessor'] as const).map((r) => (
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
          {(['admin', 'coach', 'assessor'] as const).map((r) => (
            <Button
              key={r}
              label={r.toUpperCase()}
              variant={selectedMemberForRole?.role === r ? 'primary' : 'ghost'}
              onPress={async () => {
                if (selectedMemberForRole) {
                  await updateRoleMut.mutateAsync({ memberId: selectedMemberForRole.id, role: r });
                }
                setSelectedMemberForRole(null);
              }}
              loading={updateRoleMut.isPending && selectedMemberForRole?.role !== r}
            />
          ))}
        </View>
      </Modal>
    </Screen>
  );
}
