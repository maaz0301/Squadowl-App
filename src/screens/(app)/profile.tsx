import { useState } from 'react';
import { Text, View, Alert } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen } from '@/components/ui';
import { useThemeStore } from '@/state/themeStore';
import { useUser, useAuthStore, usePermissions } from '@/state/authStore';
import { getPlanDefinition, canUseFeature } from '@/data/plans';
import { useUpdateProfileMutation, useUpdatePasswordMutation, useGuardianRostersQuery, useTeamsQuery, useTryoutsQuery, useSeasonsQuery } from '@/features/queries';
import { getDataSource } from '@/data';

export default function ProfileScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const updateProfile = useUpdateProfileMutation();
  const updatePasswordMut = useUpdatePasswordMutation();
  const { role } = usePermissions();
  const guardianQuery = useGuardianRostersQuery();
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const seasonsQuery = useSeasonsQuery();

  const isGuardianOnly = !!(
    guardianQuery.data &&
    guardianQuery.data.length > 0 &&
    tryoutsQuery.data?.length === 0 &&
    seasonsQuery.data?.length === 0 &&
    teamsQuery.data?.length === 0
  );

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [organization, setOrganization] = useState(user?.organization ?? '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [loadingPortal, setLoadingPortal] = useState(false);

  const plan = getPlanDefinition(user?.planTier ?? 'coach');

  const saveProfile = async () => {
    await updateProfile.mutateAsync({
      displayName: displayName.trim() || user?.displayName,
      organization: organization.trim() || undefined,
    });
    setEditing(false);
  };

  const savePassword = async () => {
    if (password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    try {
      await updatePasswordMut.mutateAsync(password);
      if (user) {
        await updateProfile.mutateAsync({
          onboardingSteps: { ...user.onboardingSteps, changePassword: true },
        });
      }
      setChangingPassword(false);
      setPassword('');
      alert('Password updated successfully');
    } catch (e: any) {
      alert(e.message || 'Failed to update password');
    }
  };

  const openPortal = async () => {
    try {
      setLoadingPortal(true);
      const res = await getDataSource().createPortalSession();
      if (res?.url) {
        if (await InAppBrowser.isAvailable()) {
          await InAppBrowser.open(res.url, {
            // iOS Properties
            dismissButtonStyle: 'close',
            preferredBarTintColor: colors.bg,
            preferredControlTintColor: colors.primary,
            readerMode: false,
            animated: true,
            modalPresentationStyle: 'fullScreen',
            modalTransitionStyle: 'coverVertical',
            modalEnabled: true,
            enableBarCollapsing: false,
            // Android Properties
            showTitle: true,
            toolbarColor: colors.bg,
            secondaryToolbarColor: colors.border,
            navigationBarColor: colors.bg,
            navigationBarDividerColor: 'white',
            enableUrlBarHiding: true,
            enableDefaultShare: false,
            forceCloseOnRedirection: false,
            animations: {
              startEnter: 'slide_in_right',
              startExit: 'slide_out_left',
              endEnter: 'slide_in_left',
              endExit: 'slide_out_right'
            },
          });
        } else {
          // Fallback if in-app browser is not available
          const { Linking } = require('react-native');
          await Linking.openURL(res.url);
        }
      }
    } catch (err: any) {
      Alert.alert('Portal Error', err.message || 'Something went wrong.');
    } finally {
      setLoadingPortal(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="Profile" showBack />
      <Card accent className="mb-4 gap-2 items-center py-4">
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-2"
          style={{ backgroundColor: colors.tile }}
        >
          <Text className="text-3xl font-display font-bold" style={{ color: colors.primary }}>
            {user?.displayName?.charAt(0) ?? 'C'}
          </Text>
        </View>
        {editing ? (
          <View className="w-full gap-3">
            <Input label="Display name" value={displayName} onChangeText={setDisplayName} />
            <Input label="Organization" value={organization} onChangeText={setOrganization} />
            <View className="flex-row gap-2">
              <Button label="Save" onPress={saveProfile} loading={updateProfile.isPending} />
              <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
            </View>
          </View>
        ) : (
          <>
            <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
              {user?.displayName}
            </Text>
            <Text style={{ color: colors.inkMuted }}>{user?.email}</Text>
            {user?.organization ? (
              <Text style={{ color: colors.inkFaint }}>{user.organization}</Text>
            ) : null}
            <View className="flex-row gap-2 mt-1">
              <Badge label={`Role: ${isGuardianOnly ? 'guardian' : role}`} variant="info" />
              {!isGuardianOnly && <Badge label={`Plan: ${plan.name}`} variant="brand" />}
              {user?.subscriptionStatus && <Badge label={user.subscriptionStatus} variant={user.subscriptionStatus === 'active' ? 'success' : 'default'} />}
            </View>
            
            <View className="flex-row gap-2 mt-2">
              <Button label="Edit Account" variant="ghost" size="sm" onPress={() => setEditing(true)} />
              <Button label="Change Password" variant="secondary" size="sm" onPress={() => setChangingPassword(true)} />
            </View>
          </>
        )}
        {changingPassword ? (
          <View className="w-full gap-3 mt-4 border-t pt-4" style={{ borderColor: colors.border }}>
            <Input label="New Password" value={password} onChangeText={setPassword} secureTextEntry />
            <View className="flex-row gap-2">
              <Button label="Save Password" onPress={savePassword} loading={updatePasswordMut.isPending} />
              <Button label="Cancel" variant="ghost" onPress={() => { setChangingPassword(false); setPassword(''); }} />
            </View>
          </View>
        ) : null}
      </Card>

      {!isGuardianOnly && (
        <>
          <Card className="mb-4 gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Plan Limits
            </Text>
            <Text style={{ color: colors.inkMuted }}>
              Assessments: {plan.limits.assessments} · Players: {plan.limits.players} · Teams:{' '}
              {plan.limits.teams}
            </Text>
            <View className="flex-row gap-2 mt-2">
              <Button label="Upgrade Plan" variant="secondary" onPress={() => navigation.navigate('Upgrade')} className="flex-1" />
              {user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing' ? (
                <Button label="Manage Subscription" variant="secondary" onPress={openPortal} loading={loadingPortal} className="flex-1" />
              ) : null}
            </View>
          </Card>

          <Card className="mb-4 gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Quick Links
            </Text>
            <Button label="Search" variant="ghost" onPress={() => navigation.navigate('Search')} />
            <Button label="Manage Organization Members" variant="ghost" onPress={() => navigation.navigate('OrganizationMembers')} />
            <Button label="Archived Assessments" variant="ghost" onPress={() => navigation.navigate('ArchivedAssessments')} />
            <Button label="Send Feedback" variant="ghost" onPress={() => navigation.navigate('Feedback')} />
            <Button label="Gift a Coach" variant="ghost" onPress={() => navigation.navigate('FriendPackages')} />
          </Card>

          <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Appearance
          </Text>
          <Text style={{ color: colors.inkMuted }}>Theme: {themeMode === 'system' ? 'System' : themeMode}</Text>
          <Button label="Toggle Dark/Light" variant="ghost" onPress={toggleTheme} />
        </Card>
        </>
      )}

      {!isGuardianOnly && canUseFeature(user?.planTier ?? 'free', 'enterprise') ? (
        <>
          <Button label="Enterprise Dashboard" onPress={() => navigation.navigate('Enterprise')} className="mb-3" />
          <Button
            label="Admin Portal (Demo)"
            variant="secondary"
            onPress={() => navigation.navigate('Admin')}
            className="mb-3"
          />
        </>
      ) : null}

      <Button
        label="Log Out"
        variant="danger"
        onPress={() => logout()}
      />
    </Screen>
  );
}
