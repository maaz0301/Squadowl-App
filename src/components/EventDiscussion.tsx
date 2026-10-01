import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';

import { Button, useTypeToConfirm } from '@/components/ui';
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

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Comments and files for one event. Everyone who can see the event can read
 * and post comments (a guardian speaks for their athlete); only `canManage`
 * users (coaches) attach or remove files, and can remove any comment.
 * Collapsed until opened so an event list doesn't fire two reads per card.
 */
export function EventDiscussion({
  seasonId,
  eventId,
  canManage = false,
  currentUserId,
}: {
  seasonId: string;
  eventId: string;
  canManage?: boolean;
  /** Lets a user remove their own comment. */
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const typeToConfirm = useTypeToConfirm();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const comments = useEventCommentsQuery(eventId, { enabled: open });
  const files = useEventFilesQuery(eventId, { enabled: open });
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

  const commentCount = comments.data?.length;
  const fileCount = files.data?.length;
  const summary =
    commentCount == null && fileCount == null ? 'Comments & files' : `Comments (${commentCount ?? 0}) · Files (${fileCount ?? 0})`;

  return (
    <View className="mt-2">
      {typeToConfirm.modal}
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6} accessibilityRole="button">
        <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
          {open ? 'Hide comments & files' : summary}
        </Text>
      </Pressable>

      {open ? (
        <View className="mt-2 gap-3">
          <View className="gap-1.5">
            <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Files</Text>
            {files.isLoading ? <ActivityIndicator /> : null}
            {files.data?.length === 0 ? (
              <Text className="text-sm" style={{ color: colors.inkFaint }}>No files attached.</Text>
            ) : null}
            {files.data?.map((f) => (
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
