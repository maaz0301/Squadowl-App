import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { Badge, Button, Card, Chip, Input } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useInviteTeamManagerMutation,
  useRemoveTeamManagerMutation,
  useTeamManagersQuery,
} from '@/features/queries';
import { TEAM_MANAGER_ROLES, type PlanTier, type TeamManagerRole } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * CLUB mode delegation: hand this one team to another coach or manager by
 * email. They get the team, its roster, schedule, and chat — and nothing else
 * on the club's account. The club's own staff keep full access either way,
 * which is why this list never affects the inviter's own rights.
 *
 * Gated on `enterprise` (Club tier) to match where the feature was sold.
 */

const ROLE_LABEL: Record<TeamManagerRole, string> = {
  manager: 'Manager',
  coach: 'Coach',
};

interface Props {
  teamId: string;
  teamName: string;
  /**
   * True when the viewer reached this team through a delegation of their own.
   * Delegates can see who else manages the team but can't change the list —
   * can_delegate_team() enforces the same thing server-side.
   */
  readOnly?: boolean;
  /**
   * Tier to gate the "Team Managers" feature against — effectiveTierForTeam's
   * result from the parent. Delegation is sold at Club tier, but it's the
   * *owning club's* tier that should decide whether a delegate sees this
   * card, not their own personal plan.
   */
  tierOverride?: PlanTier;
}

export function TeamManagersCard({ teamId, teamName, readOnly, tierOverride }: Props) {
  const colors = useThemeColors();
  const { data: managers = [], isLoading } = useTeamManagersQuery(teamId);
  const invite = useInviteTeamManagerMutation(teamId);
  const remove = useRemoveTeamManagerMutation(teamId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamManagerRole>('manager');

  // Matches the showAlert helper the team/assessment screens already use:
  // RN's Alert is a no-op on web, where this app also runs.
  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') (globalThis as any).alert?.(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      await invite.mutateAsync({ email: trimmed, role });
      setEmail('');
      showAlert(
        'Access granted',
        `${trimmed} can now manage ${teamName}. They'll see it on their dashboard the next time they open the app.`,
      );
    } catch (e: any) {
      showAlert('Could not grant access', e?.message || 'Something went wrong.');
    }
  };

  const handleRemove = (id: string, who: string) => {
    const confirm = async () => {
      try {
        await remove.mutateAsync(id);
      } catch (e: any) {
        showAlert('Could not remove', e?.message || 'Something went wrong.');
      }
    };
    if (Platform.OS === 'web') {
      if ((globalThis as any).confirm?.(`Remove ${who} from ${teamName}?`)) confirm();
      return;
    }
    Alert.alert('Remove access', `Remove ${who} from ${teamName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: confirm },
    ]);
  };

  return (
    <PlanGate feature="enterprise" title="Team Managers" tierOverride={tierOverride}>
      <Card className="gap-3">
        <View>
          <Text className="font-display font-bold text-base" style={{ color: colors.ink }}>
            Team Managers
          </Text>
          <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
            Give another coach or manager access to run {teamName}. They'll see this team's roster,
            schedule, and chat — but nothing else on your account. You keep full access.
          </Text>
        </View>

        {isLoading ? (
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            Loading…
          </Text>
        ) : managers.length === 0 ? (
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            No one else manages this team yet.
          </Text>
        ) : (
          <View className="gap-2">
            {managers.map((m) => (
              <View
                key={m.id}
                className="flex-row items-center gap-2 rounded-xl px-3 py-2"
                style={{ backgroundColor: colors.tile }}
              >
                <View className="flex-1">
                  <Text className="font-bold text-sm" style={{ color: colors.ink }} numberOfLines={1}>
                    {m.name || m.email}
                  </Text>
                  {m.name ? (
                    <Text className="text-xs" style={{ color: colors.inkMuted }} numberOfLines={1}>
                      {m.email}
                    </Text>
                  ) : null}
                </View>
                <Badge label={ROLE_LABEL[m.role]} variant="info" />
                {readOnly ? null : (
                  <Button
                    label="Remove"
                    variant="ghost"
                    size="sm"
                    loading={remove.isPending && remove.variables === m.id}
                    onPress={() => handleRemove(m.id, m.name || m.email)}
                  />
                )}
              </View>
            ))}
          </View>
        )}

        {readOnly ? null : (
          <View className="gap-2">
            <Input
              label="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="coach@example.com"
            />
            <View className="flex-row gap-2">
              {TEAM_MANAGER_ROLES.map((r) => (
                <Chip key={r} label={ROLE_LABEL[r]} active={role === r} onPress={() => setRole(r)} />
              ))}
            </View>
            <Button
              label="Grant Access"
              size="sm"
              disabled={!email.trim()}
              loading={invite.isPending}
              onPress={handleInvite}
            />
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              If they don't have a TryoutHQ account yet, one is created and their sign-in details are
              emailed to them.
            </Text>
          </View>
        )}
      </Card>
    </PlanGate>
  );
}
