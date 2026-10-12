import { useMemo } from 'react';
import { Alert, Linking, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Card } from '@/components/ui';
import { StorageMeterBar } from '@/components/video/StorageMeter';
import {
  useAccountVideosQuery,
  useDeleteAccountVideoMutation,
  useManageVideoStorageMutation,
  useSetVideoPermissionsMutation,
  useVideoStorageQuery,
} from '@/features/queries';
import { getDataSource } from '@/data';
import {
  VIDEO_STORAGE_PLANS,
  formatBytes,
  formatPlanPrice,
  type AccountVideo,
  type VideoContext,
  type VideoStorageGb,
} from '@/data/videoStorage';
import {
  purchaseVideoStorageNative,
  storeSubscriptionsUrl,
  useNativeVideoStoragePurchase,
} from '@/lib/videoStorageIap';
import { useThemeColors } from '@/theme/ThemeProvider';

const CONTEXT_LABEL: Record<VideoContext, string> = {
  library: 'Library',
  report_card: 'Report card',
  evaluation: 'Evaluation',
  team_post: 'Team feed',
};

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * Video storage inside the Library: the meter, the plans and their prices, who
 * may upload and download, and every stored video with its size and a Delete.
 */
export function VideoStoragePanel() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const storage = useVideoStorageQuery();
  const info = storage.data;
  const videosQuery = useAccountVideosQuery(undefined, { enabled: !!info?.canManage });
  const deleteVideo = useDeleteAccountVideoMutation();
  const setPerms = useSetVideoPermissionsMutation();
  const manage = useManageVideoStorageMutation();
  const native = useNativeVideoStoragePurchase();

  const buy = useMutation({
    mutationFn: async (gb: VideoStorageGb) => {
      if (native) {
        await purchaseVideoStorageNative(gb);
        return;
      }
      const res = await getDataSource().createVideoStorageCheckoutSession(gb);
      if (res?.url) await Linking.openURL(res.url);
    },
    onError: (e) => Alert.alert('Could not start the purchase', e instanceof Error ? e.message : 'Try again.'),
  });

  const videos = useMemo(() => videosQuery.data ?? [], [videosQuery.data]);

  // Staff and managers only; players and guardians never see account storage.
  if (!info || (!info.canManage && !info.canUpload)) return null;

  const confirmDelete = (video: AccountVideo) =>
    Alert.alert('Delete video', `Delete "${video.title || video.fileName}"? This frees ${formatBytes(video.sizeBytes)}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteVideo.mutate(video.id, {
            onError: (e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.'),
          }),
      },
    ]);

  const changeSize = (gb: VideoStorageGb) => {
    const plan = VIDEO_STORAGE_PLANS.find((p) => p.gb === gb)!;
    Alert.alert(
      `Switch to ${plan.label}?`,
      gb > info.gb
        ? `You will be charged the difference for the rest of your year. After that it is ${formatPlanPrice(plan)}.`
        : `${plan.label} is ${formatPlanPrice(plan)} from your next renewal. There is no refund for the current year.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: () =>
            manage.mutate(
              { action: 'change', storageGb: gb },
              { onError: (e) => Alert.alert('Could not change the size', e instanceof Error ? e.message : 'Try again.') },
            ),
        },
      ],
    );
  };

  const resume = () =>
    manage.mutate(
      { action: 'resume' },
      { onError: (e) => Alert.alert('Could not resume', e instanceof Error ? e.message : 'Try again.') },
    );

  const goCancel = () => {
    if (info.source === 'apple' || info.source === 'google') {
      Linking.openURL(storeSubscriptionsUrl(info.source)).catch(() => undefined);
      return;
    }
    navigation.navigate('CancelVideoStorage', { reason: 'addon' });
  };

  const scheduledDeletion = info.deletionAt;
  const ending = info.entitled && info.cancelAt != null;

  return (
    <View className="mb-4 gap-4">
        {/* Not on a plan that includes video storage */}
        {!info.planEligible ? (
          <Card className="gap-2">
            <Text className="font-display font-bold text-base" style={{ color: colors.ink }}>
              Video storage needs a paid plan
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Upload compressed videos to the Library, report cards, evaluations and the team feed. It is sold as a yearly
              add-on for Coach, Coach+ and Club plans.
            </Text>
            <Button label="See plans" onPress={() => navigation.navigate('Upgrade')} />
          </Card>
        ) : null}

        {/* Eligible, nothing bought yet */}
        {info.planEligible && !info.entitled && info.canManage ? (
          <Card className="gap-3">
            <Text className="font-display font-bold text-base" style={{ color: colors.ink }}>
              Add video storage
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              One yearly add-on, shared by every team on your account. Videos are compressed to 720p before they upload, and
              are never deleted because of age.
            </Text>
            {VIDEO_STORAGE_PLANS.map((plan) => (
              <View
                key={plan.gb}
                className="flex-row items-center justify-between rounded-xl border p-3"
                style={{ borderColor: colors.border }}
              >
                <View>
                  <Text className="text-base font-bold" style={{ color: colors.ink }}>
                    {plan.name} · {plan.label}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {formatPlanPrice(plan)}
                  </Text>
                </View>
                <Button
                  size="sm"
                  label="Choose"
                  loading={buy.isPending && buy.variables === plan.gb}
                  disabled={buy.isPending}
                  onPress={() => buy.mutate(plan.gb)}
                />
              </View>
            ))}
          </Card>
        ) : null}

        {/* Videos waiting on deletion after the add-on ended */}
        {!info.entitled && info.videoCount > 0 ? (
          <Card className="gap-2" style={{ borderColor: '#ef4444' }}>
            <Text className="font-display font-bold text-base" style={{ color: '#ef4444' }}>
              Your videos are scheduled for deletion
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {scheduledDeletion
                ? `${info.videoCount} video${info.videoCount === 1 ? '' : 's'} will be permanently deleted on ${dateLabel(scheduledDeletion)}.`
                : `${info.videoCount} video${info.videoCount === 1 ? '' : 's'} will be permanently deleted.`}{' '}
              Add video storage again to keep them.
            </Text>
          </Card>
        ) : null}

        {info.entitled ? (
          <>
            <Card className="gap-3">
              <StorageMeterBar info={info} />
              <View className="flex-row flex-wrap items-center gap-2">
                <Badge label={`${VIDEO_STORAGE_PLANS.find((p) => p.gb === info.gb)?.name ?? ''} ${info.gb} GB`.trim()} variant="info" />
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {info.videoCount} video{info.videoCount === 1 ? '' : 's'}
                </Text>
              </View>
              {ending ? (
                <View className="gap-2 rounded-xl border p-3" style={{ borderColor: '#ef4444' }}>
                  <Text className="text-sm font-bold" style={{ color: '#ef4444' }}>
                    Cancelled. Videos delete on {dateLabel(info.cancelAt!)}.
                  </Text>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    They stay available until then. We will email you 7 days and 1 day before.
                  </Text>
                  {info.canManage && info.source === 'stripe' ? (
                    <Button variant="secondary" label="Keep my storage" onPress={resume} loading={manage.isPending} />
                  ) : null}
                </View>
              ) : null}
            </Card>

            {info.canManage ? (
              <Card className="gap-3">
                <Text className="font-display font-bold text-base" style={{ color: colors.ink }}>
                  Who can upload and view
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  The coach can always upload. Players and guardians can watch videos but not download them unless you allow it.
                </Text>
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 pr-3 text-base" style={{ color: colors.ink }}>
                    Managers and assessors can upload
                  </Text>
                  <Switch
                    value={info.managersCanUpload}
                    onValueChange={(v) => setPerms.mutate({ accountId: info.accountId, managersCanUpload: v })}
                    trackColor={{ true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 pr-3 text-base" style={{ color: colors.ink }}>
                    Players and guardians can download
                  </Text>
                  <Switch
                    value={info.viewersCanDownload}
                    onValueChange={(v) => setPerms.mutate({ accountId: info.accountId, viewersCanDownload: v })}
                    trackColor={{ true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Who sees each Library video is set on the item itself with the Library audience toggles. Videos managers and
                  assessors upload count against this account's storage.
                </Text>
              </Card>
            ) : null}

            {info.canManage && info.source === 'stripe' && !ending ? (
              <Card className="gap-2">
                <Text className="font-display font-bold text-base" style={{ color: colors.ink }}>
                  Change size
                </Text>
                {VIDEO_STORAGE_PLANS.filter((p) => p.gb !== info.gb).map((plan) => (
                  <View key={plan.gb} className="flex-row items-center justify-between">
                    <Text className="text-base" style={{ color: colors.ink }}>
                      {plan.name} · {plan.label} · {formatPlanPrice(plan)}
                    </Text>
                    <Button size="sm" variant="secondary" label="Switch" onPress={() => changeSize(plan.gb)} loading={manage.isPending} />
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        ) : null}

        {info.canManage && videos.length > 0 ? (
          <View className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Stored videos
            </Text>
            {videos.map((video) => (
              <Card key={video.id} className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                    {video.title || video.fileName}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    {CONTEXT_LABEL[video.context]} · {formatBytes(video.sizeBytes)} · {dateLabel(video.createdAt)}
                  </Text>
                </View>
                <Button size="sm" variant="danger" label="Delete" onPress={() => confirmDelete(video)} />
              </Card>
            ))}
          </View>
        ) : null}

        {info.entitled && info.canManage && !ending ? (
          <Button variant="ghost" label="Cancel video storage" onPress={goCancel} />
        ) : null}
        {info.entitled && (info.source === 'apple' || info.source === 'google') ? (
          <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
            This storage is billed through {info.source === 'apple' ? 'the App Store' : 'Google Play'}.
          </Text>
        ) : null}
    </View>
  );
}
