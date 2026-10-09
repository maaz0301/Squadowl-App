import { useState } from 'react';
import { Text, View, Alert, Linking, Pressable, Switch, ScrollView } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors, useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen, Avatar, Modal } from '@/components/ui';
import { BottomNav } from '@/components/BottomNav';
import { LegalLinks } from '@/components/LegalLinks';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '@/config/app';
import { FeatureBlockGate } from '@/components/FeatureBlockGate';
import { useThemeStore } from '@/state/themeStore';
import { useUser, useAuthStore, usePermissions } from '@/state/authStore';
import { getPlanDefinition, canUseFeature, formatLimit, getTeamAllowance } from '@/data/plans';
import {
  useUpdateProfileMutation,
  useUpdatePasswordMutation,
  useGuardianRostersQuery,
  useTeamsQuery,
  useSeasonsQuery,
  useUploadCoachPhotoMutation,
  useUploadOrganizationLogoMutation,
  useIsFeedbackReviewerQuery,
  usePlatformBlockedFeaturesQuery,
} from '@/features/queries';
import { getDataSource } from '@/data';
import { launchImageLibrary } from 'react-native-image-picker';
import { PasswordSchema } from '@/data/types';

export default function ProfileScreen() {
  const colors = useThemeColors();
  const { isDark } = useTheme();
  const navigation = useNavigation<any>();
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const updateProfile = useUpdateProfileMutation();
  const updatePasswordMut = useUpdatePasswordMutation();
  const uploadPhoto = useUploadCoachPhotoMutation();
  const uploadOrgLogo = useUploadOrganizationLogoMutation();
  const { role, isGuardian } = usePermissions();
  const { data: isFeedbackReviewer } = useIsFeedbackReviewerQuery(!isGuardian);
  const guardianQuery = useGuardianRostersQuery();
  const teamsQuery = useTeamsQuery();
  const seasonsQuery = useSeasonsQuery();
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const profileBlocked = (platformBlockedFeatures ?? []).includes('profile');


  const isGuardianOnly = isGuardian;

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [organization, setOrganization] = useState(user?.organization ?? '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);
  // Signing out waits on a network call before the session is torn down, so
  // without this the button sat there looking untapped and invited a second
  // press on top of the first.
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const deleteConfirmed = deleteText.trim() === 'DELETE';

  const plan = getPlanDefinition(user?.planTier ?? 'free');
  const extraTeamLicenses = user?.extraTeamLicenses ?? 0;

  const saveProfile = async () => {
    await updateProfile.mutateAsync({
      displayName: displayName.trim() || user?.displayName,
      organization: organization.trim() || undefined,
    });
    setEditing(false);
  };

  const selectPhoto = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });
    if (!result.didCancel && result.assets && result.assets.length > 0 && user?.id) {
      try {
        await uploadPhoto.mutateAsync({
          userId: user.id,
          fileUri: result.assets[0].uri!,
          fileType: 'image/jpeg',
        });
        Alert.alert('Success', 'Profile picture updated successfully!');
      } catch (e: any) {
        Alert.alert('Upload Error', 'Failed to upload photo: ' + e.message);
      }
    }
  };

  const selectOrganizationLogo = async () => {
    const result = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, quality: 0.9 });
    const asset = result.assets?.[0];
    if (result.didCancel || !asset?.uri) return;
    try {
      const url = await uploadOrgLogo.mutateAsync({ fileUri: asset.uri, fileType: asset.type || 'image/png' });
      await updateProfile.mutateAsync({ organizationLogoUrl: url });
    } catch (e: any) {
      Alert.alert('Logo Upload Error', 'Failed to upload logo: ' + (e?.message ?? 'Please try again.'));
    }
  };

  const removeOrganizationLogo = async () => {
    try {
      await updateProfile.mutateAsync({ organizationLogoUrl: '' });
    } catch (e: any) {
      Alert.alert('Could not remove logo', e?.message ?? 'Please try again.');
    }
  };

  const savePassword = async () => {
    const validation = PasswordSchema.safeParse(password);
    if (!validation.success) {
      Alert.alert('Validation Error', validation.error.issues[0].message);
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
      Alert.alert('Success', 'Password updated successfully');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update password');
    }
  };

  const closeDeleteModal = () => {
    if (deletingAccount) return;
    setDeleteOpen(false);
    setDeleteText('');
  };

  // Typing "delete" is the confirmation — a bare OK/Cancel alert is too easy to
  // tap through for something that cannot be undone.
  const handleDeleteAccount = async () => {
    if (!deleteConfirmed || deletingAccount) return;
    setDeletingAccount(true);
    try {
      await deleteAccount();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not delete your account.');
      setDeletingAccount(false);
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
    <Screen padded={false}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <Header title="Profile" showBack />
      {profileBlocked ? (
        <FeatureBlockGate feature="profile" allowSignOut />
      ) : (
      <>
      <Card accent className="mb-4 gap-2 items-center py-4">
        <Pressable onPress={selectPhoto} disabled={uploadPhoto.isPending} className="items-center mb-2">
          <Avatar
            first={user?.displayName?.split(' ')[0] ?? 'C'}
            last={user?.displayName?.split(' ')[1] ?? ''}
            size={80}
            uri={user?.avatarUrl}
          />
          <Text className="text-xs mt-1" style={{ color: colors.primary }}>
            {uploadPhoto.isPending ? 'Uploading...' : 'Tap to change photo'}
          </Text>
        </Pressable>
        {editing ? (
          <View className="w-full gap-3">
            <Input label="Display name" value={displayName} onChangeText={setDisplayName} />
            <Input label="Organization" value={organization} onChangeText={setOrganization} />
            <View className="gap-3">
              <View className="flex-row items-center gap-3">
                <Pressable onPress={selectOrganizationLogo} accessibilityLabel="Upload organization logo">
                  <Avatar uri={user?.organizationLogoUrl} first="O" last="G" size={56} />
                </Pressable>
                <View className="flex-1">
                  <Text className="font-semibold" style={{ color: colors.ink }}>Organization logo</Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    Printed at the top of exported reports on the Club plan.
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                <Button
                  label={uploadOrgLogo.isPending ? 'Uploading...' : user?.organizationLogoUrl ? 'Change logo' : 'Upload logo'}
                  variant="secondary"
                  onPress={selectOrganizationLogo}
                  disabled={uploadOrgLogo.isPending}
                />
                {user?.organizationLogoUrl ? <Button label="Remove" variant="ghost" onPress={removeOrganizationLogo} /> : null}
              </View>
            </View>
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
              <Badge 
                label={`Role: ${
                  isGuardianOnly 
                    ? 'Guardian' 
                    : role === 'admin' 
                    ? 'Coach' 
                    : role.charAt(0).toUpperCase() + role.slice(1)
                }`} 
                variant="info" 
              />
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
            <View>
              <Input label="New Password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} />
              <Pressable 
                onPress={() => setShowPassword(!showPassword)} 
                className="flex-row items-center gap-2 mt-4 ml-1 mb-1"
              >
                <View 
                  style={{ 
                    width: 20, 
                    height: 20, 
                    borderWidth: 1, 
                    borderColor: showPassword ? colors.primary : colors.border, 
                    borderRadius: 4, 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    backgroundColor: showPassword ? colors.primary : 'transparent' 
                  }}
                >
                  {showPassword && <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>}
                </View>
                <Text style={{ color: colors.inkMuted }}>Show password</Text>
              </Pressable>
            </View>
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
              Evaluations: {formatLimit(plan.limits.assessments)} · Players: {formatLimit(plan.limits.players)} · Teams:{' '}
              {formatLimit(getTeamAllowance(user?.planTier ?? 'free', user?.extraTeamLicenses ?? 0))}
            </Text>
            {extraTeamLicenses > 0 ? (
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Includes {extraTeamLicenses} purchased team license{extraTeamLicenses === 1 ? '' : 's'}.
              </Text>
            ) : null}
            <View className="flex-row gap-2 mt-2">
              {!(platformBlockedFeatures ?? []).includes('billing') ? (
                <Button label="Upgrade Plan" variant="secondary" onPress={() => navigation.navigate('Upgrade')} className="flex-1" />
              ) : null}
              {user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing' ? (
                <Button label="Manage Subscription" variant="secondary" onPress={openPortal} loading={loadingPortal} className="flex-1" />
              ) : null}
            </View>
            {canUseFeature(user?.planTier ?? 'free', 'payments') ? (
              <Button
                label="Payment Dashboard"
                variant="secondary"
                className="mt-2"
                onPress={() => navigation.navigate('Payments')}
              />
            ) : null}
          </Card>

          <Card className="mb-4 gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Quick Links
            </Text>
            <Button label="Search" variant="ghost" onPress={() => navigation.navigate('Search')} />
            {!(platformBlockedFeatures ?? []).includes('organization') ? (
              <Button label="Manage Organization Members" variant="ghost" onPress={() => navigation.navigate('OrganizationMembers')} />
            ) : null}
            <Button label="Athlete Hub" variant="ghost" onPress={() => navigation.navigate('AthleteHub')} />
            <Button label="Video Storage" variant="ghost" onPress={() => navigation.navigate('Storage')} />
            <Button label="Archived" variant="ghost" onPress={() => navigation.navigate('ArchivedAssessments')} />
            <Button label="Send Feedback" variant="ghost" onPress={() => navigation.navigate('Feedback')} />
            {/* The portal is limited to an email allowlist held in the database
                (`feedback_reviewers`), not to a plan or a role, so whether to
                offer it is a question only the server can answer. */}
            {isFeedbackReviewer ? (
              <Button
                label="Feedback Portal"
                variant="ghost"
                onPress={() => navigation.navigate('FeedbackReports')}
              />
            ) : null}
            {!(platformBlockedFeatures ?? []).includes('loyalty') ? (
              <Button label="Loyalty Program" variant="ghost" onPress={() => navigation.navigate('Loyalty')} />
            ) : null}
            <Button label="Privacy Policy" variant="ghost" onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} />
            <Button label="Terms of Service" variant="ghost" onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)} />
          </Card>

          <Card className="mb-4 gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Appearance
            </Text>
            <View className="flex-row items-center justify-between mt-2">
              <Text style={{ color: colors.inkMuted, fontSize: 16 }}>
                Dark Mode
              </Text>
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
              />
            </View>
          </Card>
        </>
      )}

      {/* Everyone else finds these in Quick Links; guardians have no Quick Links card. */}
      {isGuardianOnly ? <LegalLinks /> : null}

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.danger }}>
          Danger Zone
        </Text>
        <Text className="text-xs" style={{ color: colors.inkMuted }}>
          Deleting your account permanently removes your login and profile. This cannot be undone.
        </Text>
        <Button label="Delete Account" variant="danger" size="sm" onPress={() => setDeleteOpen(true)} />
      </Card>

      <Modal
        visible={deleteOpen}
        title="Delete Account"
        onClose={closeDeleteModal}
        footer={
          <View className="mt-4 gap-2">
            <Button
              label="Delete Account"
              variant="danger"
              disabled={!deleteConfirmed}
              loading={deletingAccount}
              onPress={handleDeleteAccount}
            />
            <Button label="Cancel" variant="secondary" disabled={deletingAccount} onPress={closeDeleteModal} />
          </View>
        }
      >
        <Text className="text-sm mb-3" style={{ color: colors.inkMuted }}>
          This permanently deletes your account, login and profile. This cannot be undone.
        </Text>
        <Input
          label="Type DELETE to confirm"
          value={deleteText}
          onChangeText={setDeleteText}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="DELETE"
          editable={!deletingAccount}
          returnKeyType="done"
          onSubmitEditing={handleDeleteAccount}
        />
      </Modal>

      <Button
        label="Log Out"
        variant="danger"
        loading={signingOut}
        onPress={async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            await logout();
          } finally {
            // The screen unmounts with the session in the normal case; this is
            // for the one where the teardown failed and the button has to come
            // back rather than stay stuck mid-press.
            setSigningOut(false);
          }
        }}
      />
      </>
      )}
      </ScrollView>
      <BottomNav active="profile" />
    </Screen>
  );
}
