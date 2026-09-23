import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { Badge, Button, Card, Input } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useInviteTeamManagerMutation,
  useRemoveTeamManagerMutation,
  useTeamManagersQuery,
} from '@/features/queries';
import type { PlanTier, TeamManagerRole } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Delegation: hand this one team to another manager by email. They get the
 * team, its roster, schedule, and chat, its athletes' profiles, that team's
 * payment records, and its evaluations (on the owning account's plan) — but
 * nothing else on the account (other teams, org billing, org membership). The account's own
 * staff keep full access either way, which is why this list never affects
 * the inviter's own rights. A delegate can also manage this list themselves,
 * on this team only — they cannot delegate a team they don't already manage.
 *
 * Every new grant here is role 'manager' — 'coach' is no longer offered as
 * an invite option (it doubles as evaluation access, which delegation
 * doesn't include), but ROLE_LABEL keeps 'coach' mapped so a row granted
 * before this change still displays correctly.
 *
 * Gated on `teamManagers` (Coach+ and up) — mirrors the web app's plans.ts,
 * which sells this starting at Coach+, not just Club/enterprise.
 */

const ROLE_LABEL: Record<TeamManagerRole, string> = {
  manager: 'Manager',
  coach: 'Coach',
};

interface Props {
  teamId: string;
  teamName: string;
  /**
   * Optional override to force the list read-only regardless of what the
   * viewer is otherwise permitted. A delegate of this team can manage this
   * list themselves (can_delegate_team() permits it server-side too, as of
   * 20260827120000_team_manager_full_access.sql) — this prop no longer needs
   * to be set from team.managed for that case.
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
      // 'coach' is no longer offered here — only the account's own staff
      // get evaluation access to a delegated team, so every new delegate
      // this card grants is a 'manager'. Existing 'coach'-labeled rows from
      // before this change still display and work as before.
      const result = await invite.mutateAsync({ email: trimmed, role: 'manager' });
      setEmail('');
      showAlert(
        result.pending ? 'Invitation sent' : 'Access granted',
        result.pending
          ? `We emailed ${trimmed} asking them to create an account. Access to ${teamName} is granted automatically when they sign up with that address.`
          : `${trimmed} can now manage ${teamName}. They'll see it on their dashboard the next time they open the app.`,
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
    <PlanGate feature="teamManagers" title="Team Managers" tierOverride={tierOverride}>
      <Card className="gap-3">
        <View>
          <Text className="font-display font-bold text-base" style={{ color: colors.ink }}>
            Team Managers
          </Text>
          <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
            Give another manager access to run {teamName}. They'll see this team's roster, schedule,
            and chat, and can create and run its evaluations — but nothing else on your account. You keep full access.
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
                {m.pending ? <Badge label="Invited" variant="warning" /> : null}
                <Badge label={ROLE_LABEL[m.role]} variant="info" />
                {readOnly ? null : (
                  <Button
                    label={m.pending ? 'Cancel invite' : 'Remove'}
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
              placeholder="manager@example.com"
            />
            <Button
              label="Grant Access"
              size="sm"
              disabled={!email.trim()}
              loading={invite.isPending}
              onPress={handleInvite}
            />
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              They'll get an email with an Accept Invitation button. If they don't have a TryoutHQ
              account yet, the email asks them to create one — access is granted automatically when they do.
            </Text>
          </View>
        )}
      </Card>
    </PlanGate>
  );
}
