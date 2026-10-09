import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button } from '@/components/ui';
import {
  useDeleteAccountVideoMutation,
  useInvalidateVideoStorage,
  useVideoContextAccountQuery,
  useVideoStorageQuery,
  useVideosForContextQuery,
} from '@/features/queries';
import { getDataSource } from '@/data';
import {
  VIDEO_PHASE_LABEL,
  formatBytes,
  friendlyVideoError,
  type AccountVideo,
  type VideoContext,
  type VideoUploadProgress,
} from '@/data/videoStorage';
import { compressAndUploadVideo, pickVideo, VideoCompressorUnavailable } from '@/lib/videoUpload';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { VideoPlayerModal } from './VideoPlayerModal';

interface ContextVideosProps {
  context: VideoContext;
  /** The saved Library item, report card, evaluation or post the videos belong to. */
  contextId: string | undefined;
  /** The account that owns the storage. Defaults to the signed-in user's own account. */
  accountId?: string;
  title?: string;
  /** Show playback only (no upload or delete). */
  readOnly?: boolean;
}

/**
 * The videos attached to one thing, with an "Add video" button for people who
 * may upload. Every upload is compressed first and counts against the account's
 * shared storage quota, which the server enforces.
 */
export function ContextVideos({ context, contextId, accountId: accountIdProp, title = 'Videos', readOnly }: ContextVideosProps) {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  // The account is looked up from the thing the video belongs to, so a delegated
  // team manager uses the club's storage rather than their own account's.
  const resolved = useVideoContextAccountQuery(context, contextId, { enabled: !readOnly && !accountIdProp });
  const accountId = accountIdProp ?? resolved.data ?? undefined;
  const storage = useVideoStorageQuery(accountId, { enabled: !!contextId && !readOnly && (!!accountIdProp || resolved.isSuccess) });
  const videosQuery = useVideosForContextQuery(context, contextId ? [contextId] : []);
  const deleteVideo = useDeleteAccountVideoMutation();
  const invalidate = useInvalidateVideoStorage();
  const [progress, setProgress] = useState<VideoUploadProgress | null>(null);
  const [playing, setPlaying] = useState<AccountVideo | null>(null);

  const info = storage.data;
  const videos = videosQuery.data ?? [];
  const full = !!info && info.quotaBytes - info.usedBytes <= 0;
  const canAdd = !readOnly && !!contextId && !!info?.canUpload;
  const busy = progress !== null && progress.phase !== 'done';

  if (!contextId) return null;
  // Nothing to show to a viewer, and no storage to offer a person who cannot buy it.
  if (!videos.length && !canAdd && !(info?.canManage && info.planEligible && !info.entitled && !readOnly)) return null;

  const add = async () => {
    try {
      const picked = await pickVideo();
      if (!picked) return;
      const uploaded = await compressAndUploadVideo({
        file: picked,
        context,
        title: picked.name,
        accountId,
        onProgress: setProgress,
      });
      try {
        await getDataSource().attachAccountVideo(uploaded.id, context, contextId);
      } catch (e) {
        await getDataSource().deleteAccountVideo(uploaded.id).catch(() => undefined);
        throw e;
      }
      invalidate();
    } catch (e) {
      if (e instanceof VideoCompressorUnavailable) Alert.alert('Update needed', e.message);
      else Alert.alert('Could not add the video', friendlyVideoError(e instanceof Error ? e.message : undefined));
    } finally {
      setProgress(null);
    }
  };

  const remove = (video: AccountVideo) =>
    Alert.alert('Delete video', `Delete "${video.title || video.fileName}"? This frees ${formatBytes(video.sizeBytes)} of storage.`, [
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

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        {title}
      </Text>

      {videos.map((video) => (
        <View
          key={video.id}
          className="flex-row items-center gap-2 rounded-xl border p-2.5"
          style={{ borderColor: colors.border }}
        >
          <View className="flex-1">
            <Text className="text-sm font-bold" style={{ color: colors.ink }} numberOfLines={1}>
              {video.title || video.fileName}
            </Text>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {formatBytes(video.sizeBytes)}
            </Text>
          </View>
          <Button size="sm" variant="secondary" label="Play" disabled={!video.url} onPress={() => setPlaying(video)} />
          {!readOnly && (info?.canManage || video.createdBy === user?.id) ? (
            <Button size="sm" variant="danger" label="Delete" onPress={() => remove(video)} />
          ) : null}
        </View>
      ))}

      {busy && progress ? (
        <View className="gap-1">
          <Text className="text-sm font-bold" style={{ color: colors.ink }}>
            {VIDEO_PHASE_LABEL[progress.phase]}... {Math.round(progress.fraction * 100)}%
          </Text>
          <View style={{ height: 8, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(progress.fraction * 100)}%`, height: '100%', backgroundColor: colors.primary }} />
          </View>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Compressing, then uploading. Keep the app open.
          </Text>
        </View>
      ) : null}

      {canAdd ? (
        <>
          <Button
            variant="secondary"
            label={full ? 'Storage full' : 'Add video'}
            onPress={add}
            disabled={busy || full}
            loading={busy}
          />
          {full ? (
            <Text className="text-xs" style={{ color: '#ef4444' }}>
              Your video storage is full. Delete videos or choose a larger size.
            </Text>
          ) : null}
        </>
      ) : null}

      {!readOnly && info?.canManage && info.planEligible && !info.entitled ? (
        <Button variant="secondary" label="Add video storage" onPress={() => navigation.navigate('Storage')} />
      ) : null}

      <VideoPlayerModal url={playing?.url ?? null} title={playing?.title || playing?.fileName || 'Video'} onClose={() => setPlaying(null)} />
    </View>
  );
}
