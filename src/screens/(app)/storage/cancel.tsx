import { useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { Button, Card, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { useAccountVideosQuery, useManageVideoStorageMutation, useVideoStorageQuery } from '@/features/queries';
import { getDataSource } from '@/data';
import { formatBytes } from '@/data/videoStorage';
import { useThemeColors } from '@/theme/ThemeProvider';

const RED = '#ef4444';

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * The two-screen warning shown before anything that deletes videos.
 *
 *   Screen 1  full-screen warning listing every video and the total stored, with
 *             Go Back as the prominent button and Continue kept quiet.
 *   Screen 2  the coach must type DELETE exactly before the button turns on.
 *
 * Reached with `reason: 'addon'` (cancel the storage add-on) or `reason: 'plan'`
 * (about to cancel or drop the plan below Coach+, which also removes storage). For
 * 'plan' it ends by opening the Stripe billing portal, where the change is made.
 * Nothing is deleted here: Stripe keeps the storage until the paid period ends and
 * the maintenance function deletes the files then, after two reminder emails.
 */
export default function CancelVideoStorageScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const reason: 'addon' | 'plan' = route.params?.reason === 'plan' ? 'plan' : 'addon';

  const storage = useVideoStorageQuery();
  const videosQuery = useAccountVideosQuery();
  const manage = useManageVideoStorageMutation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);

  const info = storage.data;
  const videos = videosQuery.data ?? [];

  if (storage.isLoading || videosQuery.isLoading) return <LoadingState message="Loading your videos..." />;
  if (storage.isError || !info) {
    return (
      <Screen>
        <Header title="Cancel" showBack />
        <ErrorState message="Could not load your video storage." onRetry={() => storage.refetch()} />
      </Screen>
    );
  }

  const totalBytes = info.usedBytes;
  const deletionDate = info.deletionAt ?? info.cancelAt;

  const openPortal = async () => {
    const res = await getDataSource().createPortalSession();
    if (!res?.url) return;
    if (await InAppBrowser.isAvailable()) {
      await InAppBrowser.open(res.url, { dismissButtonStyle: 'close', preferredBarTintColor: colors.bg, preferredControlTintColor: colors.primary });
    } else {
      await Linking.openURL(res.url);
    }
  };

  const confirm = async () => {
    setWorking(true);
    try {
      if (reason === 'addon') {
        const res = await manage.mutateAsync({ action: 'cancel', confirm: 'DELETE' });
        setEndsAt(res.cancelAt ? new Date(res.cancelAt).getTime() : null);
        setStep(3);
      } else {
        await getDataSource().acknowledgeVideoDeletion(info.accountId);
        await openPortal();
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Could not continue', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setWorking(false);
    }
  };

  // Screen 3: nothing deleted yet.
  if (step === 3) {
    return (
      <Screen>
        <Header title="Storage cancelled" />
        <View className="flex-1 justify-center gap-4 px-2">
          <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
            Your videos stay until {endsAt ? dateLabel(endsAt) : 'the end of your billing period'}
          </Text>
          <Text className="text-base" style={{ color: colors.inkMuted }}>
            Everything remains available until then. We will email you 7 days and 1 day before, and again when the videos
            are permanently deleted. You can keep your storage any time before that from Storage.
          </Text>
          <Button label="Done" onPress={() => navigation.navigate('Library')} />
        </View>
      </Screen>
    );
  }

  // Screen 2: type DELETE.
  if (step === 2) {
    const ready = typed === 'DELETE';
    return (
      <Screen>
        <Header title="Confirm" showBack onBack={() => setStep(1)} />
        <ScrollView contentContainerStyle={{ paddingBottom: 32, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text className="text-2xl font-display font-bold" style={{ color: RED }}>
            This permanently deletes {videos.length} video{videos.length === 1 ? '' : 's'}
          </Text>
          <Text className="text-base" style={{ color: colors.inkMuted }}>
            Once deleted, {formatBytes(totalBytes)} of video cannot be recovered. To continue, type DELETE below exactly as
            shown, in capital letters.
          </Text>
          <Input
            label="Type DELETE"
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
          />
          <Button
            label={reason === 'addon' ? 'Cancel storage and delete videos' : 'Continue to billing'}
            variant="danger"
            disabled={!ready || working}
            loading={working}
            onPress={confirm}
          />
          <Button label="Go back" variant="secondary" onPress={() => navigation.goBack()} />
        </ScrollView>
      </Screen>
    );
  }

  // Screen 1: the warning.
  return (
    <Screen>
      <Header title={reason === 'addon' ? 'Cancel video storage' : 'Before you continue'} showBack />
      <ScrollView contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <Text className="text-2xl font-display font-bold" style={{ color: RED }}>
          Everything will be deleted
        </Text>
        <Text className="text-base" style={{ color: colors.ink }}>
          {reason === 'addon'
            ? 'Cancelling video storage deletes every video stored for this account.'
            : 'Cancelling your plan, or moving below Coach+, ends video storage and deletes every video stored for this account.'}{' '}
          {deletionDate ? `They stay available until ${dateLabel(deletionDate)}` : 'They stay available until the end of your billing period'}
          , then they are permanently removed.
        </Text>

        <Card className="gap-2">
          <Text className="text-sm font-bold" style={{ color: colors.ink }}>
            {videos.length} video{videos.length === 1 ? '' : 's'} · {formatBytes(totalBytes)} used
          </Text>
          {videos.slice(0, 40).map((v) => (
            <View key={v.id} className="flex-row justify-between gap-3">
              <Text className="flex-1 text-sm" style={{ color: colors.inkMuted }} numberOfLines={1}>
                {v.title || v.fileName}
              </Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {formatBytes(v.sizeBytes)}
              </Text>
            </View>
          ))}
          {videos.length > 40 ? (
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              and {videos.length - 40} more
            </Text>
          ) : null}
        </Card>

        {/* Go Back is the loud button; Continue is deliberately small and quiet. */}
        <Button label="Go back" size="lg" onPress={() => navigation.goBack()} />
        <Button label="Continue" size="sm" variant="ghost" onPress={() => setStep(2)} />
        {reason === 'plan' ? (
          <Button
            label="I only need to view or update billing details"
            size="sm"
            variant="ghost"
            onPress={() => openPortal().then(() => navigation.goBack()).catch((e) => Alert.alert('Portal Error', e?.message ?? 'Try again.'))}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
