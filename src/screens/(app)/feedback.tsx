import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Header, Input, Screen } from '@/components/ui';
import { useIsFeedbackReviewerQuery, useSubmitFeedbackMutation } from '@/features/queries';
import { getDataSource } from '@/data';
import type { FeedbackAttachment } from '@/data/extras';

/** Mirrors the `feedback-attachments` bucket's own limit — see the migration. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Enough for a bug report; keeps one submission from filling the bucket. */
const MAX_ATTACHMENTS = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What each score means, shown next to the row so a 3 isn't left to interpretation. */
const RATING_WORDS = ['', 'Poor', 'Fair', 'Okay', 'Good', 'Excellent'] as const;

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const colors = useThemeColors();
  // The chosen score is coloured by what it says, so a page of ratings can be
  // read down the right-hand edge without parsing the numbers.
  const tone = value <= 2 ? colors.danger : value === 3 ? colors.warning : colors.success;
  return (
    <View className="gap-2 mb-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-bold" style={{ color: colors.ink }}>
          {label}
        </Text>
        <Text className="text-xs font-bold" style={{ color: tone }}>
          {RATING_WORDS[value]}
        </Text>
      </View>
      <View
        className="flex-row overflow-hidden rounded-lg border"
        style={{ borderColor: colors.border, backgroundColor: colors.tile }}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${n} out of 5, ${RATING_WORDS[n]}`}
              className="flex-1 items-center justify-center py-3"
              style={{ backgroundColor: active ? tone : 'transparent' }}
            >
              <Text className="font-bold" style={{ color: active ? '#fff' : colors.inkMuted }}>
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function FeedbackScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const submit = useSubmitFeedbackMutation();
  const [overallExperience, setOverallExperience] = useState(4);
  const [easeOfUse, setEaseOfUse] = useState(4);
  const [teamHubScheduling, setTeamHubScheduling] = useState(4);
  const [valueForMoney, setValueForMoney] = useState(4);
  const [whatIsWorkingWell, setWhatIsWorkingWell] = useState('');
  const [whatCanBeImproved, setWhatCanBeImproved] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Attachments are uploaded as they're picked rather than on submit, so the
  // coach can see what's attached — and take one off again — before sending.
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // Thumbnails come from the picked file's local URI, not from the bucket: the
  // bucket is private, so showing the stored object back would mean minting a
  // signed URL per file straight after uploading it.
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const reviewerQuery = useIsFeedbackReviewerQuery();

  const pickAttachments = async () => {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      Alert.alert('Too many files', `You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }

    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: room,
    });
    if (result.didCancel || !result.assets?.length) return;

    const picked = result.assets.filter((a) => !!a.uri);
    const oversized = picked.filter((a) => (a.fileSize ?? 0) > MAX_ATTACHMENT_BYTES);
    if (oversized.length > 0) {
      Alert.alert(
        'File too large',
        `${oversized.map((a) => a.fileName ?? 'A screenshot').join(', ')}, attachments are limited to ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      );
    }

    const toUpload = picked.filter((a) => (a.fileSize ?? 0) <= MAX_ATTACHMENT_BYTES);
    if (toUpload.length === 0) return;

    setUploading(true);
    const ds = getDataSource();
    const failed: string[] = [];
    for (const asset of toUpload) {
      const name = asset.fileName ?? 'screenshot.jpg';
      try {
        const uploaded = await ds.uploadFeedbackAttachment({
          uri: asset.uri!,
          name,
          type: asset.type ?? 'image/jpeg',
          size: asset.fileSize ?? 0,
        });
        setAttachments((cur) => [...cur, uploaded]);
        setPreviews((cur) => ({ ...cur, [uploaded.path]: asset.uri! }));
      } catch (e: any) {
        // One bad file shouldn't discard the ones that did upload, so the
        // failures are collected and reported together at the end.
        failed.push(`${name}: ${e?.message ?? 'upload failed'}`);
      }
    }
    setUploading(false);
    if (failed.length > 0) Alert.alert('Some files were not attached', failed.join('\n'));
  };

  const removeAttachment = async (attachment: FeedbackAttachment) => {
    setAttachments((cur) => cur.filter((a) => a.path !== attachment.path));
    setPreviews((cur) => {
      if (!cur[attachment.path]) return cur;
      const next = { ...cur };
      delete next[attachment.path];
      return next;
    });
    try {
      await getDataSource().deleteFeedbackAttachment(attachment.path);
    } catch {
      // The file is already off the form; a leftover object in the bucket is
      // not worth putting an error in front of the coach for.
    }
  };

  // Same reliable pattern as assessment/new.tsx: KeyboardAwareScrollView's
  // auto-scroll-above-keyboard logic relies on legacy measurement APIs that
  // are unreliable under the New Architecture, and Android's adjustResize
  // manifest flag no longer shrinks the window under edge-to-edge on this
  // targetSdk. Tracking the keyboard's own height from the OS event and
  // applying it as padding ourselves needs no view measurement or native
  // resize at all.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const applyHeight = (e: KeyboardEvent) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(e.endCoordinates.height);
    };
    const hide = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(0);
    };
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, applyHeight);
    const hideSub = Keyboard.addListener(hideEvent, hide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const formTopRef = useRef(0);
  const fieldYRef = useRef<Record<string, number>>({});

  const rememberField = (key: string) => (e: LayoutChangeEvent) => {
    fieldYRef.current[key] = e.nativeEvent.layout.y;
  };

  const revealField = (key: string) => () => {
    const y = fieldYRef.current[key];
    if (y == null) return;
    // Wait out the keyboard-open animation so we scroll against the final,
    // already-shortened viewport rather than the full-height one.
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(formTopRef.current + y - 12, 0), animated: true });
    }, 120);
  };

  const handleSubmit = async () => {
    await submit.mutateAsync({
      overallExperience,
      easeOfUse,
      teamHubScheduling,
      valueForMoney,
      whatIsWorkingWell,
      whatCanBeImproved,
      attachments,
    });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Screen scroll>
        <Header title="Feedback" showBack />
        <Card accent className="mt-4 gap-3 items-center py-8">
          <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
            Thank you!
          </Text>
          <Text className="text-center" style={{ color: colors.inkMuted }}>
            Your feedback helps us improve the coach experience.
          </Text>
          <Button label="Back to Profile" onPress={() => navigation.goBack()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} keyboardAvoiding={false} padded={false}>
      <View style={{ flex: 1, paddingBottom: keyboardHeight }}>
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <Header title="Team Feedback Survey" subtitle="Help us improve" showBack />
          <Card
            className="mt-4 gap-2"
            onLayout={(e) => {
              formTopRef.current = e.nativeEvent.layout.y;
            }}
          >
            <Text style={{ color: colors.inkMuted }}>
              Rate your experience with evaluations, scoring, and Team Hub.
            </Text>
            <RatingRow label="Overall experience" value={overallExperience} onChange={setOverallExperience} />
            <RatingRow label="Ease of use" value={easeOfUse} onChange={setEaseOfUse} />
            <RatingRow label="Team Hub & scheduling" value={teamHubScheduling} onChange={setTeamHubScheduling} />
            <RatingRow label="Value for money" value={valueForMoney} onChange={setValueForMoney} />
            <View onLayout={rememberField('whatIsWorkingWell')}>
              <Input
                label="What's working well?"
                value={whatIsWorkingWell}
                onChangeText={setWhatIsWorkingWell}
                onFocus={revealField('whatIsWorkingWell')}
                multiline
                numberOfLines={3}
              />
            </View>
            <View onLayout={rememberField('whatCanBeImproved')}>
              <Input
                label="What can be improved?"
                value={whatCanBeImproved}
                onChangeText={setWhatCanBeImproved}
                onFocus={revealField('whatCanBeImproved')}
                multiline
                numberOfLines={3}
              />
            </View>
            <View className="gap-2">
              <Text className="font-bold" style={{ color: colors.ink }}>
                Attachments
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Screenshots help us reproduce a problem. Up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.
              </Text>

              {attachments.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {attachments.map((a) => (
                    <View
                      key={a.path}
                      className="overflow-hidden rounded-lg border"
                      style={{ borderColor: colors.border, backgroundColor: colors.tile, width: 104 }}
                    >
                      {previews[a.path] ? (
                        <Image
                          source={{ uri: previews[a.path] }}
                          style={{ width: 104, height: 80 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="items-center justify-center" style={{ width: 104, height: 80 }}>
                          <Text className="text-2xl">📄</Text>
                        </View>
                      )}
                      <View className="px-1.5 py-1">
                        <Text className="text-xs" style={{ color: colors.ink }} numberOfLines={1}>
                          {a.name}
                        </Text>
                        <Text className="text-xs" style={{ color: colors.inkMuted }}>
                          {formatBytes(a.size)}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => removeAttachment(a)}
                        accessibilityLabel={`Remove ${a.name}`}
                        className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full"
                        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                      >
                        <Text className="text-xs font-bold text-white">✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              {attachments.length < MAX_ATTACHMENTS ? (
                <Pressable
                  onPress={pickAttachments}
                  disabled={uploading}
                  className="items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-5"
                  style={{ borderColor: colors.border }}
                >
                  {uploading ? (
                    <>
                      <ActivityIndicator color={colors.primary} />
                      <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                        Uploading...
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text className="text-2xl">📎</Text>
                      <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                        Add screenshots
                      </Text>
                      <Text className="text-xs" style={{ color: colors.inkFaint }}>
                        {MAX_ATTACHMENTS - attachments.length} of {MAX_ATTACHMENTS} remaining
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <Text className="text-xs" style={{ color: colors.inkFaint }}>
                  Maximum of {MAX_ATTACHMENTS} files attached.
                </Text>
              )}
            </View>

            <Button
              label="Submit Feedback"
              onPress={handleSubmit}
              loading={submit.isPending}
              disabled={uploading}
            />
          </Card>

          {reviewerQuery.data ? (
            <Card className="mt-4 gap-2">
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                You have access to the feedback portal.
              </Text>
              <Button
                label="Open Feedback Portal"
                variant="secondary"
                onPress={() => navigation.navigate('FeedbackReports')}
              />
            </Card>
          ) : null}
        </ScrollView>
      </View>
    </Screen>
  );
}
