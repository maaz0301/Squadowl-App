import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen } from '@/components/ui';
import { useThemeStore } from '@/state/themeStore';
import { useUser, useAuthStore, usePermissions } from '@/state/authStore';
import { getPlanDefinition, canUseFeature } from '@/data/plans';
import { useUpdateProfileMutation, useUpdatePasswordMutation } from '@/features/queries';

export default function ProfileScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const updateProfile = useUpdateProfileMutation();
  const updatePasswordMut = useUpdatePasswordMutation();
  const { isGuardian } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [organization, setOrganization] = useState(user?.organization ?? '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState('');

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
            {!isGuardian && <Badge label={plan.name} variant="brand" />}
            
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



      {!isGuardian && (
        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Appearance
          </Text>
          <Text style={{ color: colors.inkMuted }}>Theme: {themeMode === 'system' ? 'System' : themeMode}</Text>
          <Button label="Toggle Dark/Light" variant="ghost" onPress={toggleTheme} />
        </Card>
      )}

      {!isGuardian && canUseFeature(user?.planTier ?? 'free', 'enterprise') ? (
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
