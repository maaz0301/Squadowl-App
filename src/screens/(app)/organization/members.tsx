import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen, Tabs } from '@/components/ui';
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

  const { data: members = [], isLoading } = useOrgMembersQuery();
  const inviteMut = useInviteMemberMutation();
  const updateRoleMut = useUpdateMemberRoleMutation();
  const removeMut = useRemoveMemberMutation();

  const handleInvite = async () => {
    if (!inviteEmail) return;
    await inviteMut.mutateAsync({ email: inviteEmail, role: inviteRole });
    setInviteEmail('');
  };

  const handleRoleChange = async (member: OrgMember) => {
    const nextRoleIndex = (ORG_ROLES.indexOf(member.role) + 1) % ORG_ROLES.length;
    await updateRoleMut.mutateAsync({ memberId: member.id, role: ORG_ROLES[nextRoleIndex] });
  };

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

      {canManageOrganization && (
        <View className="px-4 mb-4">
          <Card className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Invite {tab === 'staff' ? 'Staff' : 'Guardian'}
            </Text>
            <View className="flex-row items-center gap-2">
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
                  onPress={() => {
                    const staffRoles = ['admin', 'coach', 'assessor'] as const;
                    const idx = staffRoles.indexOf(inviteRole as any);
                    setInviteRole(staffRoles[(idx + 1) % staffRoles.length]);
                  }}
                />
              )}
            </View>
            <Button
              label={`Send ${tab === 'staff' ? 'Staff' : 'Guardian'} Invite`}
              onPress={() => {
                if (tab === 'guardians') setInviteRole('guardian');
                handleInvite();
              }}
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
            <View>
              <Text className="text-base font-bold" style={{ color: colors.ink }}>
                {item.email}
              </Text>
              <View className="flex-row gap-2 mt-1">
                <Badge label={item.role.toUpperCase()} variant="brand" />
                <Badge
                  label={item.status.toUpperCase()}
                  variant={item.status === 'active' ? 'success' : 'warning'}
                />
              </View>
            </View>
            {canManageOrganization && (
              <View className="flex-row gap-2">
                {tab === 'staff' && (
                  <Button
                    label="Role"
                    variant="ghost"
                    size="sm"
                    onPress={() => handleRoleChange(item)}
                    loading={updateRoleMut.isPending}
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
    </Screen>
  );
}
