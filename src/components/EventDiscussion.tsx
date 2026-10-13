import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';

import { Button, useTypeToConfirm } from '@/components/ui';
import { HubIcon } from '@/components/teamHub/HubIcon';
import { HUB_ICONS } from '@/components/teamHub/hubTheme';
import {
  useAddEventCommentMutation,
  useDeleteEventCommentMutation,
  useDeleteEventFileMutation,
  useEventCommentsQuery,
  useEventFilesQuery,
  useUploadEventFileMutation,
} from '@/features/queries';
import { DocumentPickerUnavailable, pickAttachment } from '@/lib/documentPicker';
import { useThemeColors } from '@/theme/ThemeProvider';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i;
const kindOf = (f: { name: string; contentType: string }): 'video' | 'image' | 'info' =>
  f.contentType.startsWith('video/') || VIDEO_EXT.test(f.name)
    ? 'video'
    : f.contentType.startsWith('image/') || IMAGE_EXT.test(f.name)
      ? 'image'
      : 'info';

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Comments and files for one event. Everyone who can see the event can read
 * and post comments (a guardian speaks for their athlete); only `canManage`
 * users (coaches) attach or remove files, and can remove any comment.
 * Shown under the selected event only, so it reads its counts straight away: four
 * indicators (video, info, picture, comments) show what has been added.
 */
export function EventDiscussion({
  seasonId,
  eventId,
  canManage = false,
  hideVideo = false,
  currentUserId,
}: {
  seasonId: string;
  eventId: string;
  canManage?: boolean;
  /** Guardians do not get video options; those live on the subscriber's hub screens. */
  hideVideo?: boolean;
  /** Lets a user remove their own comment. */
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const typeToConfirm = useTypeToConfirm();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const comments = useEventCommentsQuery(eventId, { enabled: true });
  const files = useEventFilesQuery(eventId, { enabled: true });
  const addComment = useAddEventCommentMutation(eventId);
  const deleteComment = useDeleteEventCommentMutation(eventId);
  const upload = useUploadEventFileMutation(seasonId, eventId);
  const deleteFile = useDeleteEventFileMutation(eventId);

  const fail = (title: string, e: unknown) =>
    Alert.alert(title, e instanceof Error ? e.message : 'Please try again.');

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await addComment.mutateAsync(body);
      setDraft('');
    } catch (e) {
      fail('Could not post comment', e);
    }
  };

  const attach = async () => {
    try {
      const file = await pickAttachment();
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        Alert.alert('File too large', 'Files can be up to 20 MB.');
        return;
      }
      await upload.mutateAsync(file);
    } catch (e) {
      if (e instanceof DocumentPickerUnavailable) Alert.alert('File Picker Not Available', e.message);
      else fail('Could not upload file', e);
    }
  };

  const confirm = (title: string, onYes: () => void) =>
    typeToConfirm.ask({ title: 'Remove', message: title, confirmLabel: 'Remove', onConfirm: onYes });

  const visibleFiles = hideVideo ? files.data?.filter((f) => kindOf(f) !== 'video') : files.data;
  const counts = { video: 0, info: 0, image: 0 };
  for (const f of visibleFiles ?? []) counts[kindOf(f)] += 1;
  const indicators = [
    ...(hideVideo ? [] : [{ key: 'video', icon: HUB_ICONS.video, label: 'Video', count: files.data ? counts.video : undefined }]),
    { key: 'info', icon: HUB_ICONS.info, label: 'Info', count: files.data ? counts.info : undefined },
    { key: 'image', icon: HUB_ICONS.image, label: 'Photo', count: files.data ? counts.image : undefined },
    { key: 'comments', icon: HUB_ICONS.chat, label: 'Comments', count: comments.data?.length },
  ];

  return (
    <View className="mt-2">
      {typeToConfirm.modal}
      <Text className="text-xs font-bold mb-2" style={{ color: colors.primary }}>Comments & files</Text>
      <View className="flex-row gap-2">
        {indicators.map((i) => {
          const has = (i.count ?? 0) > 0;
          const tint = has ? colors.primary : colors.inkMuted;
          return (
            <Pressable
              key={i.key}
              onPress={() => setOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel={`${i.label}${i.count == null ? '' : `: ${i.count}`}`}
              accessibilityState={{ expanded: open }}
              className="flex-1 items-center justify-center rounded-lg border"
              style={{
                height: 52,
                backgroundColor: has ? 'rgba(255,107,43,0.12)' : colors.tile,
                borderColor: has ? colors.primary : colors.border,
              }}
            >
              <View className="flex-row items-center gap-1">
                <HubIcon d={i.icon} size={14} color={tint} />
                <Text className="text-xs font-bold" style={{ color: tint }}>{i.count ?? '–'}</Text>
              </View>
              <Text numberOfLines={1} style={{ fontSize: 10, color: tint }}>{i.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {open ? (
        <View className="mt-2 gap-3">
          <View className="gap-1.5">
            <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Files</Text>
            {files.isLoading ? <ActivityIndicator /> : null}
            {visibleFiles?.length === 0 ? (
              <Text className="text-sm" style={{ color: colors.inkFaint }}>No files attached.</Text>
            ) : null}
            {visibleFiles?.map((f) => (
              <View key={f.id} className="flex-row items-center justify-between rounded-md border px-3 py-2" style={{ borderColor: colors.border, backgroundColor: colors.tile }}>
                <Pressable className="flex-1 pr-2" disabled={!f.url} onPress={() => f.url && Linking.openURL(f.url)}>
                  <Text className="text-sm font-semibold" numberOfLines={1} style={{ color: colors.primary }}>{f.name}</Text>
                  <Text className="text-xs" style={{ color: colors.inkFaint }}>{formatSize(f.size)}</Text>
                </Pressable>
                {canManage ? (
                  <Pressable hitSlop={8} onPress={() => confirm(`Remove ${f.name}?`, () => deleteFile.mutate(f, { onError: (e) => fail('Could not remove file', e) }))}>
                    <Text className="text-sm" style={{ color: colors.danger }}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {canManage ? <Button label="Attach a file" variant="secondary" loading={upload.isPending} onPress={attach} /> : null}
          </View>

          <View className="gap-1.5">
            <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Comments</Text>
            {comments.isLoading ? <ActivityIndicator /> : null}
            {comments.isError ? <Text className="text-sm" style={{ color: colors.danger }}>Could not load comments.</Text> : null}
            {comments.data?.length === 0 ? (
              <Text className="text-sm" style={{ color: colors.inkFaint }}>No comments yet.</Text>
            ) : null}
            {comments.data?.map((c) => (
              <View key={c.id} className="rounded-md border px-3 py-2" style={{ borderColor: colors.border, backgroundColor: colors.tile }}>
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs font-bold" style={{ color: colors.ink }}>
                    {c.authorName || 'Member'}
                    <Text className="font-normal" style={{ color: colors.inkFaint }}>  {new Date(c.createdAt).toLocaleString()}</Text>
                  </Text>
                  {canManage || c.authorUserId === currentUserId ? (
                    <Pressable hitSlop={8} onPress={() => confirm('Remove this comment?', () => deleteComment.mutate(c.id, { onError: (e) => fail('Could not remove comment', e) }))}>
                      <Text className="text-xs" style={{ color: colors.danger }}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text className="mt-0.5 text-sm" style={{ color: colors.ink }}>{c.body}</Text>
              </View>
            ))}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a comment"
              placeholderTextColor={colors.inkFaint}
              multiline
              maxLength={2000}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: colors.border, color: colors.ink, backgroundColor: colors.tile, minHeight: 44 }}
            />
            <Button label="Post comment" loading={addComment.isPending} disabled={!draft.trim()} onPress={post} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
