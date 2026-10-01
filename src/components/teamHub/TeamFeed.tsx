import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';

import { Button, Chip, Input, Modal, useTypeToConfirm } from '@/components/ui';
import {
  FeedUploadError,
  useAddPostCommentMutation,
  useCreateOrgInfoMutation,
  useCreateSeasonPostMutation,
  useDeleteOrgInfoFileMutation,
  useDeleteOrgInfoMutation,
  useDeletePostCommentMutation,
  useDeletePostFileMutation,
  useDeleteSeasonPostMutation,
  useOrgInfoQuery,
  usePostCommentsQuery,
  useSeasonPostsQuery,
} from '@/features/queries';
import { DocumentPickerUnavailable, pickAttachment, type PickedAttachment } from '@/lib/documentPicker';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  ORG_INFO_CATEGORIES,
  ORG_INFO_CATEGORY_LABELS,
  type FeedFile,
  type OrgInfoCategory,
  type OrgInfoItem,
  type SeasonEvent,
  type SeasonPost,
} from '@/data/types';
import { Badge } from '@/components/ui';
import { HubSectionLabel } from './HubSection';
import { HUB_ICONS, useHubSurfaces } from './hubTheme';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatWhen = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function formatTime(value?: string): string {
  const m = value ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The next few events that haven't ended yet, soonest first. */
function upcoming(events: SeasonEvent[], limit = 3): SeasonEvent[] {
  const today = todayKey();
  return events
    .filter((e) => (e.endDate || e.date) >= today)
    .sort((a, b) => `${a.date} ${a.startTime ?? ''}`.localeCompare(`${b.date} ${b.startTime ?? ''}`))
    .slice(0, limit);
}

function FileRow({ file, onRemove }: { file: FeedFile; onRemove?: () => void }) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between rounded-md border px-3 py-2"
      style={{ borderColor: colors.border, backgroundColor: colors.tile }}
    >
      <Pressable className="flex-1 pr-2" disabled={!file.url} onPress={() => file.url && Linking.openURL(file.url)}>
        <Text className="text-sm font-semibold" numberOfLines={1} style={{ color: colors.primary }}>
          {file.name}
        </Text>
        <Text className="text-xs" style={{ color: colors.inkFaint }}>{formatSize(file.size)}</Text>
      </Pressable>
      {onRemove ? (
        <Pressable hitSlop={8} onPress={onRemove}>
          <Text className="text-sm" style={{ color: colors.danger }}>Remove</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Files chosen in a composer but not yet uploaded. */
function usePendingFiles() {
  const [files, setFiles] = useState<PickedAttachment[]>([]);
  const add = async () => {
    try {
      const file = await pickAttachment();
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        Alert.alert('File too large', 'Files can be up to 20 MB.');
        return;
      }
      setFiles((prev) => [...prev, file]);
    } catch (e) {
      if (e instanceof DocumentPickerUnavailable) Alert.alert('File Picker Not Available', e.message);
      else Alert.alert('Could not attach file', e instanceof Error ? e.message : 'Please try again.');
    }
  };
  return { files, add, remove: (i: number) => setFiles((prev) => prev.filter((_, n) => n !== i)), clear: () => setFiles([]) };
}

function PendingFiles({ pending }: { pending: ReturnType<typeof usePendingFiles> }) {
  const colors = useThemeColors();
  return (
    <View className="gap-1.5">
      {pending.files.map((f, i) => (
        <View
          key={`${f.name}-${i}`}
          className="flex-row items-center justify-between rounded-md border px-3 py-2"
          style={{ borderColor: colors.border, backgroundColor: colors.tile }}
        >
          <Text className="flex-1 pr-2 text-sm" numberOfLines={1} style={{ color: colors.ink }}>
            {f.name} · {formatSize(f.size)}
          </Text>
          <Pressable hitSlop={8} onPress={() => pending.remove(i)}>
            <Text className="text-sm" style={{ color: colors.danger }}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Button label="Attach a file" variant="secondary" size="sm" onPress={pending.add} />
    </View>
  );
}

function PostComments({
  seasonId,
  post,
  canModerate,
  currentUserId,
}: {
  seasonId: string;
  post: SeasonPost;
  canModerate: boolean;
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const comments = usePostCommentsQuery(post.id, { enabled: open });
  const add = useAddPostCommentMutation(seasonId, post.id);
  const remove = useDeletePostCommentMutation(seasonId, post.id);
  const typeToConfirm = useTypeToConfirm();

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await add.mutateAsync(body);
      setDraft('');
    } catch (e) {
      Alert.alert('Could not post comment', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const confirmRemove = (id: string) =>
    typeToConfirm.ask({
      title: 'Remove Comment',
      message: 'Remove this comment?',
      confirmLabel: 'Remove',
      onConfirm: () =>
        remove.mutate(id, {
          onError: (e) => Alert.alert('Could not remove comment', e instanceof Error ? e.message : 'Please try again.'),
        }),
    });

  return (
    <View className="mt-2">
      {typeToConfirm.modal}
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6} accessibilityRole="button">
        <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
          {open ? 'Hide comments' : post.commentCount ? `Comments (${post.commentCount})` : 'Comment'}
        </Text>
      </Pressable>
      {open ? (
        <View className="mt-2 gap-1.5">
          {comments.isLoading ? <ActivityIndicator /> : null}
          {comments.isError ? (
            <Text className="text-sm" style={{ color: colors.danger }}>Could not load comments.</Text>
          ) : null}
          {comments.data?.map((c) => (
            <View
              key={c.id}
              className="rounded-md border px-3 py-2"
              style={{ borderColor: colors.border, backgroundColor: colors.tile }}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-bold" style={{ color: colors.ink }}>
                  {c.authorName || 'Member'}
                  <Text className="font-normal" style={{ color: colors.inkFaint }}>  {formatWhen(c.createdAt)}</Text>
                </Text>
                {canModerate || c.authorUserId === currentUserId ? (
                  <Pressable hitSlop={8} onPress={() => confirmRemove(c.id)}>
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
          <Button label="Post comment" size="sm" loading={add.isPending} disabled={!draft.trim()} onPress={submit} />
        </View>
      ) : null}
    </View>
  );
}

function PostCard({
  seasonId,
  post,
  canPost,
  currentUserId,
}: {
  seasonId: string;
  post: SeasonPost;
  canPost: boolean;
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const deletePost = useDeleteSeasonPostMutation(seasonId);
  const deleteFile = useDeletePostFileMutation(seasonId);
  const typeToConfirm = useTypeToConfirm();

  const confirmDelete = () =>
    typeToConfirm.ask({
      title: 'Delete Post',
      message: 'Delete this post, its comments and files?',
      onConfirm: () =>
        deletePost.mutate(post, {
          onError: (e) => Alert.alert('Could not delete post', e instanceof Error ? e.message : 'Please try again.'),
        }),
    });

  return (
    <View
      className="rounded-lg p-3 mb-3"
      style={{ backgroundColor: s.panelBg, borderWidth: 1, borderColor: s.panelBorder }}
    >
      {typeToConfirm.modal}
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          {post.title ? (
            <Text className="text-base font-bold" style={{ color: colors.ink }}>{post.title}</Text>
          ) : null}
          <Text className="text-xs" style={{ color: colors.inkFaint }}>
            {post.authorName || 'Coach'} · {formatWhen(post.createdAt)}
          </Text>
        </View>
        {canPost ? (
          <Pressable hitSlop={8} onPress={confirmDelete} disabled={deletePost.isPending}>
            <Text className="text-sm" style={{ color: colors.danger }}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="mt-2 text-sm" style={{ color: colors.ink }}>{post.body}</Text>
      {post.files.length ? (
        <View className="mt-2 gap-1.5">
          {post.files.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              onRemove={
                canPost
                  ? () =>
                      typeToConfirm.ask({
                        title: 'Remove File',
                        message: `Remove ${f.name}?`,
                        confirmLabel: 'Remove',
                        onConfirm: () =>
                          deleteFile.mutate(f, {
                            onError: (e) => Alert.alert('Could not remove file', e instanceof Error ? e.message : 'Please try again.'),
                          }),
                      })
                  : undefined
              }
            />
          ))}
        </View>
      ) : null}
      <PostComments seasonId={seasonId} post={post} canModerate={canPost} currentUserId={currentUserId} />
    </View>
  );
}

function PostComposer({ seasonId, visible, onClose }: { seasonId: string; visible: boolean; onClose: () => void }) {
  const colors = useThemeColors();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const pending = usePendingFiles();
  const create = useCreateSeasonPostMutation(seasonId);

  const close = () => {
    setTitle('');
    setBody('');
    pending.clear();
    onClose();
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ title, body, files: pending.files });
      close();
    } catch (e) {
      if (e instanceof FeedUploadError) {
        close();
        Alert.alert('Posted', e.message);
      } else {
        Alert.alert('Could not post', e instanceof Error ? e.message : 'Please try again.');
      }
    }
  };

  return (
    <Modal
      visible={visible}
      title="Post an Update"
      onClose={close}
      footer={
        <View className="flex-row gap-2 mt-4">
          <Button label="Cancel" variant="ghost" className="flex-1" onPress={close} />
          <Button label="Post" className="flex-1" loading={create.isPending} disabled={!body.trim()} onPress={submit} />
        </View>
      }
    >
      <View className="gap-3">
        <Input label="Title (optional)" value={title} onChangeText={setTitle} maxLength={200} />
        <Input label="Message" value={body} onChangeText={setBody} multiline maxLength={5000} style={{ minHeight: 100, textAlignVertical: 'top' }} />
        <PendingFiles pending={pending} />
        <Text className="text-xs" style={{ color: colors.inkMuted }}>Everyone on the team can see this and comment.</Text>
      </View>
    </Modal>
  );
}

function OrgInfoComposer({ seasonId, visible, onClose }: { seasonId: string; visible: boolean; onClose: () => void }) {
  const colors = useThemeColors();
  const [category, setCategory] = useState<OrgInfoCategory>('announcement');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const pending = usePendingFiles();
  const create = useCreateOrgInfoMutation(seasonId);

  const close = () => {
    setCategory('announcement');
    setTitle('');
    setBody('');
    setUrl('');
    pending.clear();
    onClose();
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ category, title, body, url, files: pending.files });
      close();
    } catch (e) {
      if (e instanceof FeedUploadError) {
        close();
        Alert.alert('Saved', e.message);
      } else {
        Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
      }
    }
  };

  return (
    <Modal
      visible={visible}
      title="Add Organization Info"
      onClose={close}
      footer={
        <View className="flex-row gap-2 mt-4">
          <Button label="Cancel" variant="ghost" className="flex-1" onPress={close} />
          <Button label="Save" className="flex-1" loading={create.isPending} disabled={!title.trim()} onPress={submit} />
        </View>
      }
    >
      <View className="gap-3">
        <View className="flex-row flex-wrap">
          {ORG_INFO_CATEGORIES.map((c) => (
            <Chip key={c} label={ORG_INFO_CATEGORY_LABELS[c]} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <Input label="Title" value={title} onChangeText={setTitle} maxLength={200} />
        <Input label="Details (optional)" value={body} onChangeText={setBody} multiline maxLength={5000} style={{ minHeight: 90, textAlignVertical: 'top' }} />
        <Input label="Link (optional)" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" />
        <PendingFiles pending={pending} />
        <Text className="text-xs" style={{ color: colors.inkMuted }}>Shown to every team in your organization.</Text>
      </View>
    </Modal>
  );
}

function OrgInfoCard({ item, canPost }: { item: OrgInfoItem; canPost: boolean }) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const deleteItem = useDeleteOrgInfoMutation();
  const deleteFile = useDeleteOrgInfoFileMutation();
  const typeToConfirm = useTypeToConfirm();

  const confirmDelete = () =>
    typeToConfirm.ask({
      title: 'Delete',
      message: `Delete "${item.title}" for every team?`,
      onConfirm: () =>
        deleteItem.mutate(item, {
          onError: (e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.'),
        }),
    });

  return (
    <View
      className="rounded-lg p-3 mb-3"
      style={{ backgroundColor: s.panelBg, borderWidth: 1, borderColor: s.panelBorder }}
    >
      {typeToConfirm.modal}
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <View className="flex-row mb-1">
            <Badge label={ORG_INFO_CATEGORY_LABELS[item.category]} variant="info" />
          </View>
          <Text className="text-base font-bold" style={{ color: colors.ink }}>{item.title}</Text>
          <Text className="text-xs" style={{ color: colors.inkFaint }}>
            {item.authorName || 'Staff'} · {formatWhen(item.createdAt)}
          </Text>
        </View>
        {canPost ? (
          <Pressable hitSlop={8} onPress={confirmDelete} disabled={deleteItem.isPending}>
            <Text className="text-sm" style={{ color: colors.danger }}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
      {item.body ? <Text className="mt-2 text-sm" style={{ color: colors.ink }}>{item.body}</Text> : null}
      {item.url ? (
        <Pressable className="mt-2" onPress={() => Linking.openURL(item.url)}>
          <Text className="text-sm font-semibold" numberOfLines={1} style={{ color: colors.primary }}>{item.url}</Text>
        </Pressable>
      ) : null}
      {item.files.length ? (
        <View className="mt-2 gap-1.5">
          {item.files.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              onRemove={
                canPost
                  ? () =>
                      typeToConfirm.ask({
                        title: 'Remove File',
                        message: `Remove ${f.name}?`,
                        confirmLabel: 'Remove',
                        onConfirm: () =>
                          deleteFile.mutate(f, {
                            onError: (e) => Alert.alert('Could not remove file', e instanceof Error ? e.message : 'Please try again.'),
                          }),
                      })
                  : undefined
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A team's news feed: the next few events, coach updates (with files) that
 * members can comment on, and the organization-wide info every team shares.
 * `canPost` is the team's staff or manager; `canPostOrg` is account staff only.
 */
export function TeamFeed({
  seasonId,
  events,
  canPost,
  canPostOrg,
  currentUserId,
  onViewSchedule,
}: {
  seasonId: string;
  events: SeasonEvent[];
  canPost: boolean;
  canPostOrg: boolean;
  currentUserId?: string;
  onViewSchedule?: () => void;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const [composing, setComposing] = useState(false);
  const [composingOrg, setComposingOrg] = useState(false);
  const posts = useSeasonPostsQuery(seasonId);
  const orgInfo = useOrgInfoQuery(seasonId);
  const next = upcoming(events);

  const muted = { color: colors.inkMuted };

  return (
    <View>
      <HubSectionLabel
        icon={HUB_ICONS.calendar}
        label="Upcoming Events"
        actionLabel={onViewSchedule && events.length ? 'View All' : undefined}
        onAction={onViewSchedule}
      />
      {next.length === 0 ? (
        <Text className="text-sm mb-6" style={muted}>No upcoming events.</Text>
      ) : (
        <View className="mb-6 gap-2">
          {next.map((ev) => (
            <View
              key={ev.id}
              className="rounded-lg px-3 py-2.5"
              style={{ backgroundColor: s.panelBg, borderWidth: 1, borderColor: s.panelBorder }}
            >
              <Text className="text-sm font-bold" style={{ color: colors.ink }}>{ev.title}</Text>
              <Text className="text-xs mt-0.5" style={muted}>
                {ev.date}
                {ev.startTime ? ` · ${formatTime(ev.startTime)}` : ''}
                {ev.location ? ` · ${ev.location}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      <HubSectionLabel icon={HUB_ICONS.feed} label="Team News" />
      {canPost ? (
        <View className="mb-3">
          <Button label="+ Post an update" onPress={() => setComposing(true)} />
        </View>
      ) : null}
      {posts.isLoading ? <ActivityIndicator className="my-4" color={colors.primary} /> : null}
      {posts.isError ? (
        <Text className="text-sm mb-3" style={{ color: colors.danger }}>Could not load the feed.</Text>
      ) : null}
      {posts.data?.length === 0 ? (
        <Text className="text-sm mb-3" style={muted}>
          {canPost ? 'Nothing posted yet. Share news, reminders or files with the team.' : 'No updates yet.'}
        </Text>
      ) : null}
      {posts.data?.map((p) => (
        <PostCard key={p.id} seasonId={seasonId} post={p} canPost={canPost} currentUserId={currentUserId} />
      ))}

      <View className="mt-3">
        <HubSectionLabel icon={HUB_ICONS.clipboard} label="Organization Info" />
      </View>
      {canPostOrg ? (
        <View className="mb-3">
          <Button label="+ Add organization info" variant="secondary" onPress={() => setComposingOrg(true)} />
        </View>
      ) : null}
      {orgInfo.isLoading ? <ActivityIndicator className="my-4" color={colors.primary} /> : null}
      {orgInfo.isError ? (
        <Text className="text-sm mb-3" style={{ color: colors.danger }}>Could not load organization info.</Text>
      ) : null}
      {orgInfo.data?.length === 0 ? (
        <Text className="text-sm mb-3" style={muted}>
          {canPostOrg
            ? 'Post testing info, competition info, links or documents once and every team sees it.'
            : 'Nothing shared by the organization yet.'}
        </Text>
      ) : null}
      {orgInfo.data?.map((item) => <OrgInfoCard key={item.id} item={item} canPost={canPostOrg} />)}

      {canPost ? <PostComposer seasonId={seasonId} visible={composing} onClose={() => setComposing(false)} /> : null}
      {canPostOrg ? (
        <OrgInfoComposer seasonId={seasonId} visible={composingOrg} onClose={() => setComposingOrg(false)} />
      ) : null}
    </View>
  );
}
