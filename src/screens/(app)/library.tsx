import { useMemo, useState } from 'react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { Alert, Image, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BottomNav } from '@/components/BottomNav';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Modal,
  Screen,
  useTypeToConfirm,
} from '@/components/ui';
import {
  useCreateLibraryItemMutation,
  useDeleteLibraryItemMutation,
  useInvalidateVideoStorage,
  useLibraryQuery,
  useUpdateLibraryItemMutation,
  useVideoStorageQuery,
} from '@/features/queries';
import { getDataSource } from '@/data';
import { StorageMeterCard } from '@/components/video/StorageMeter';
import { VideoPlayerModal } from '@/components/video/VideoPlayerModal';
import {
  VIDEO_PHASE_LABEL,
  formatBytes,
  friendlyVideoError,
  type LocalVideoFile,
  type VideoUploadProgress,
} from '@/data/videoStorage';
import { compressAndUploadVideo, pickVideo, VideoCompressorUnavailable } from '@/lib/videoUpload';
import { useNavigation } from '@react-navigation/native';
import {
  DEFAULT_LIBRARY_AUDIENCE,
  LIBRARY_AUDIENCES,
  LIBRARY_AUDIENCE_LABELS,
  LIBRARY_KINDS,
  type LibraryAudienceFlags,
  type LibraryItem,
  type LibraryKind,
} from '@/data/types';
import { DocumentPickerUnavailable, pickAttachment, type PickedAttachment } from '@/lib/documentPicker';
import { usePermissions } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

const KIND_LABEL: Record<LibraryKind, string> = { note: 'Note', file: 'File', video: 'Video', link: 'Link' };
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Only http(s) addresses are ever opened; anything else a coach typed is ignored. */
function safeExternalUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

interface FormState {
  kind: LibraryKind;
  title: string;
  body: string;
  url: string;
  audience: LibraryAudienceFlags;
  file: PickedAttachment | null;
  /** A video chosen from the gallery, compressed and uploaded to account storage on save. */
  video: LocalVideoFile | null;
}

const emptyForm = (): FormState => ({
  kind: 'note',
  title: '',
  body: '',
  url: '',
  audience: { ...DEFAULT_LIBRARY_AUDIENCE },
  file: null,
  video: null,
});

export default function LibraryScreen() {
  const colors = useThemeColors();
  const { canManageOrganization, isGuardian } = usePermissions();
  const libraryQuery = useLibraryQuery();
  const refreshControl = usePullToRefresh(() => libraryQuery.refetch());
  const createItem = useCreateLibraryItemMutation();
  const updateItem = useUpdateLibraryItemMutation();
  const deleteItem = useDeleteLibraryItemMutation();
  const typeToConfirm = useTypeToConfirm();
  const navigation = useNavigation<any>();
  const storage = useVideoStorageQuery();
  const invalidateVideos = useInvalidateVideoStorage();
  const [uploadProgress, setUploadProgress] = useState<VideoUploadProgress | null>(null);
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);

  const [filter, setFilter] = useState<LibraryKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<LibraryItem | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [reading, setReading] = useState<LibraryItem | null>(null);

  const items = useMemo(() => libraryQuery.data ?? [], [libraryQuery.data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === 'all' || i.kind === filter) &&
        (!q || `${i.title} ${i.body} ${i.fileName ?? ''}`.toLowerCase().includes(q)),
    );
  }, [items, filter, search]);

  const isNew = editing === 'new';
  const showUrl = form.kind === 'link' || form.kind === 'video';
  // Uploaded videos go through account storage (compressed, counted against the quota),
  // so the plain file picker is for documents only.
  const showFile = isNew && form.kind === 'file';
  const showVideoUpload = isNew && form.kind === 'video';
  const videoInfo = storage.data;
  const multipleClubs = new Set(items.map((i) => i.accountId)).size > 1;

  const openNew = () => {
    setForm(emptyForm());
    setEditing('new');
  };
  const openEdit = (item: LibraryItem) => {
    setForm({
      kind: item.kind,
      title: item.title,
      body: item.body,
      url: item.url ?? '',
      audience: { ...item.audience },
      file: null,
      video: null,
    });
    setEditing(item);
  };

  const choose = async () => {
    try {
      const picked = await pickAttachment();
      if (!picked) return;
      if (picked.size > MAX_UPLOAD_BYTES) {
        Alert.alert('File too large', 'Uploads can be up to 50 MB. For a longer video, paste a link instead.');
        return;
      }
      setForm((f) => ({ ...f, file: picked }));
    } catch (e) {
      if (e instanceof DocumentPickerUnavailable) Alert.alert('File Picker Not Available', e.message);
      else Alert.alert('Could not pick the file', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const chooseVideo = async () => {
    try {
      const picked = await pickVideo();
      if (picked) setForm((f) => ({ ...f, video: picked }));
    } catch (e) {
      Alert.alert('Could not pick the video', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  /** Compress and upload the chosen video, create the item, then attach the video to it. */
  const saveWithVideo = async () => {
    if (!form.video) return;
    if (!form.title.trim()) {
      Alert.alert('Could not save', 'Give the item a title.');
      return;
    }
    let videoId: string | null = null;
    try {
      const uploaded = await compressAndUploadVideo({
        file: form.video,
        context: 'library',
        title: form.title.trim(),
        onProgress: setUploadProgress,
      });
      videoId = uploaded.id;
      const item = await createItem.mutateAsync({
        input: { kind: 'video', title: form.title, body: form.body, url: form.url, audience: form.audience, uploadedVideo: true },
      });
      await getDataSource().attachAccountVideo(uploaded.id, 'library', item.id);
      invalidateVideos();
      setEditing(null);
    } catch (e) {
      // Nothing may be left holding quota that no item shows.
      if (videoId) await getDataSource().deleteAccountVideo(videoId).catch(() => undefined);
      if (e instanceof VideoCompressorUnavailable) Alert.alert('Update needed', e.message);
      else Alert.alert('Could not save', friendlyVideoError(e instanceof Error ? e.message : undefined));
    } finally {
      setUploadProgress(null);
    }
  };

  const save = async () => {
    if (isNew && form.kind === 'video' && form.video) {
      await saveWithVideo();
      return;
    }
    try {
      if (isNew) {
        await createItem.mutateAsync({
          input: { kind: form.kind, title: form.title, body: form.body, url: form.url, audience: form.audience },
          file: form.kind === 'file' || form.kind === 'video' ? (form.file ?? undefined) : undefined,
        });
      } else if (editing) {
        await updateItem.mutateAsync({
          id: editing.id,
          updates: { title: form.title, body: form.body, url: form.url, audience: form.audience },
        });
      }
      setEditing(null);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const remove = (item: LibraryItem) =>
    typeToConfirm.ask({
      title: 'Delete from library',
      message: `Delete "${item.title}"? Everyone who could see it loses access.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await deleteItem.mutateAsync(item);
        } catch (e) {
          Alert.alert('Could not delete', e instanceof Error ? e.message : 'Something went wrong.');
        }
      },
    });

  // Read shows everything in the item inside the app: a note's text, a file's
  // preview, a link, each with its description and a button to open it.
  const open = (item: LibraryItem) => setReading(item);

  const openExternal = async (target: string | null | undefined) => {
    if (!target) {
      Alert.alert('Nothing to open', 'This item has no file or link.');
      return;
    }
    try {
      await Linking.openURL(target);
    } catch {
      Alert.alert('Could not open it', 'No app on this device can open this item.');
    }
  };

  if (libraryQuery.isLoading) return <LoadingState message="Loading library..." />;
  if (libraryQuery.isError) {
    return (
      <Screen>
        <Header title="Library" showBack />
        <ErrorState message="Could not load the library." onRetry={() => libraryQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {typeToConfirm.modal}
      <View className="px-4">
        <Header
          title="Library"
          showBack
          right={canManageOrganization ? <Button label="Add" size="sm" onPress={openNew} /> : undefined}
        />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        <Text className="mb-3 text-sm" style={{ color: colors.inkMuted }}>
          {canManageOrganization
            ? 'Store files, notes, videos and links, then choose who can see each one.'
            : 'Files, notes, videos and links shared with you.'}
        </Text>
        <StorageMeterCard onPress={() => navigation.navigate('Storage')} />
        <Input label="Search the library" value={search} onChangeText={setSearch} placeholder="Title or description" />
        <View className="mt-3 flex-row flex-wrap">
          <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
          {LIBRARY_KINDS.map((k) => (
            <Chip key={k} label={`${KIND_LABEL[k]}s`} active={filter === k} onPress={() => setFilter(k)} />
          ))}
        </View>

        {shown.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? 'The library is empty' : 'Nothing matches'}
            message={
              items.length === 0
                ? canManageOrganization
                  ? 'Add a file, note, video or link and choose who can see it.'
                  : 'When your coach shares something here, it will show up.'
                : 'Try a different search or filter.'
            }
          />
        ) : (
          <View className="mt-2 gap-2">
            {shown.map((item) => (
              <Card key={item.id} className="gap-2">
                <View>
                  <Text className="font-display font-bold text-base" style={{ color: colors.ink }} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    {KIND_LABEL[item.kind]}
                    {item.fileName ? ` · ${item.fileName} (${formatSize(item.fileSize)})` : ''}
                    {multipleClubs && item.accountName ? ` · ${item.accountName}` : ''}
                  </Text>
                  {item.body ? (
                    <Text className="mt-1 text-sm" style={{ color: colors.inkMuted }} numberOfLines={item.kind === 'note' ? 3 : 4}>
                      {item.body}
                    </Text>
                  ) : null}
                </View>
                {canManageOrganization ? (
                  <View className="flex-row flex-wrap gap-1.5">
                    {LIBRARY_AUDIENCES.filter((a) => item.audience[a]).map((a) => (
                      <Badge key={a} label={LIBRARY_AUDIENCE_LABELS[a]} variant="info" />
                    ))}
                    {LIBRARY_AUDIENCES.every((a) => !item.audience[a]) ? <Badge label="Only you" /> : null}
                  </View>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Read"
                    onPress={() => open(item)}
                  />
                  {canManageOrganization ? (
                    <>
                      <Button size="sm" variant="secondary" label="Edit" onPress={() => openEdit(item)} />
                      <Button size="sm" variant="danger" label="Delete" onPress={() => remove(item)} />
                    </>
                  ) : null}
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={editing !== null} title={isNew ? 'Add to Library' : 'Edit item'} onClose={() => setEditing(null)}>
        <View className="gap-3">
          {isNew ? (
            <View className="flex-row flex-wrap">
              {LIBRARY_KINDS.map((k) => (
                <Chip
                  key={k}
                  label={KIND_LABEL[k]}
                  active={form.kind === k}
                  onPress={() => setForm((f) => ({ ...f, kind: k, file: null }))}
                />
              ))}
            </View>
          ) : null}
          <Input label="Title" value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} />
          <Input
            label={form.kind === 'note' ? 'Note' : 'Description (optional)'}
            value={form.body}
            onChangeText={(v) => setForm((f) => ({ ...f, body: v }))}
            multiline
            numberOfLines={form.kind === 'note' ? 6 : 3}
            style={{ minHeight: form.kind === 'note' ? 140 : 80, textAlignVertical: 'top' }}
          />
          {showUrl ? (
            <Input
              label={form.kind === 'video' ? 'Video link (YouTube, Vimeo or any address)' : 'Link'}
              value={form.url}
              onChangeText={(v) => setForm((f) => ({ ...f, url: v }))}
              placeholder="https://"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          {showFile ? (
            <View className="gap-1">
              <Button
                variant="secondary"
                label={form.file ? 'Choose a different file' : form.kind === 'video' ? 'Or upload a video' : 'Choose a file'}
                onPress={choose}
              />
              {form.file ? (
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {form.file.name} ({formatSize(form.file.size)})
                </Text>
              ) : null}
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Up to 50 MB. For longer videos, paste a link instead.
              </Text>
            </View>
          ) : null}

          {showVideoUpload ? (
            <View className="gap-1">
              {videoInfo?.canUpload ? (
                <>
                  <Button
                    variant="secondary"
                    label={form.video ? 'Choose a different video' : 'Or upload a video'}
                    onPress={chooseVideo}
                    disabled={uploadProgress !== null}
                  />
                  {form.video ? (
                    <Text className="text-xs" style={{ color: colors.inkMuted }}>
                      {form.video.name}
                      {form.video.size ? ` (${formatBytes(form.video.size)} before compression)` : ''}
                    </Text>
                  ) : null}
                  {uploadProgress ? (
                    <View className="gap-1">
                      <Text className="text-sm font-bold" style={{ color: colors.ink }}>
                        {VIDEO_PHASE_LABEL[uploadProgress.phase]}... {Math.round(uploadProgress.fraction * 100)}%
                      </Text>
                      <View style={{ height: 8, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' }}>
                        <View style={{ width: `${Math.round(uploadProgress.fraction * 100)}%`, height: '100%', backgroundColor: colors.primary }} />
                      </View>
                    </View>
                  ) : null}
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    Compressed to 720p before it uploads, and counted against your video storage.
                  </Text>
                </>
              ) : videoInfo?.canManage && videoInfo.planEligible ? (
                <Button
                  variant="secondary"
                  label="Add video storage to upload a video"
                  onPress={() => {
                    setEditing(null);
                    navigation.navigate('Storage');
                  }}
                />
              ) : (
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Uploading videos needs video storage on a Coach+ or Club plan. You can still paste a link.
                </Text>
              )}
            </View>
          ) : null}

          <View className="rounded-xl border p-3 gap-1" style={{ borderColor: colors.border }}>
            <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Who can view this
            </Text>
            <Text className="text-xs mb-1" style={{ color: colors.inkMuted }}>
              Owners and admins always can.
            </Text>
            {LIBRARY_AUDIENCES.map((a) => (
              <Pressable
                key={a}
                onPress={() => setForm((f) => ({ ...f, audience: { ...f.audience, [a]: !f.audience[a] } }))}
                className="flex-row items-center justify-between py-1.5"
              >
                <Text className="text-base" style={{ color: colors.ink }}>
                  {LIBRARY_AUDIENCE_LABELS[a]}
                </Text>
                <Switch
                  value={form.audience[a]}
                  onValueChange={(v) => setForm((f) => ({ ...f, audience: { ...f.audience, [a]: v } }))}
                  trackColor={{ true: colors.primary }}
                  thumbColor="#fff"
                />
              </Pressable>
            ))}
          </View>

          <Button
            label={isNew ? 'Add' : 'Save'}
            onPress={save}
            loading={createItem.isPending || updateItem.isPending || uploadProgress !== null}
          />
        </View>
      </Modal>

      <Modal visible={reading !== null} title={reading?.title ?? ''} onClose={() => setReading(null)}>
        <ScrollView style={{ maxHeight: 460 }}>
          {reading?.kind === 'file' &&
          reading.fileUrl &&
          (reading.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(reading.fileName ?? '')) ? (
            <Image
              source={{ uri: reading.fileUrl }}
              resizeMode="contain"
              style={{ width: '100%', height: 260, borderRadius: 12, marginBottom: 12 }}
            />
          ) : null}
          {reading?.body ? (
            <Text className="text-base leading-6" style={{ color: colors.ink }}>
              {reading.body}
            </Text>
          ) : null}
          {reading?.fileName ? (
            <Text className="mt-3 text-xs" style={{ color: colors.inkMuted }}>
              {reading.fileName}
            </Text>
          ) : null}
          <View className="mt-4 gap-2">
            {reading?.video?.url ? (
              <Button label="Play video" onPress={() => {
                  // One modal at a time: iOS will not present the player over the open reader.
                  const target = { url: reading.video!.url!, title: reading.title };
                  setReading(null);
                  setTimeout(() => setPlaying(target), 350);
                }}
              />
            ) : null}
            {reading?.fileUrl ? (
              <Button
                label={reading.kind === 'video' ? 'Play video' : 'Open file'}
                onPress={() => openExternal(reading.fileUrl)}
              />
            ) : null}
            {safeExternalUrl(reading?.url) ? (
              <Button
                variant="secondary"
                label={reading?.kind === 'video' ? 'Watch video' : 'Open link'}
                onPress={() => openExternal(safeExternalUrl(reading?.url))}
              />
            ) : null}
          </View>
        </ScrollView>
      </Modal>

      <VideoPlayerModal url={playing?.url ?? null} title={playing?.title ?? ''} onClose={() => setPlaying(null)} />
      {isGuardian ? null : <BottomNav active="library" />}
    </Screen>
  );
}
