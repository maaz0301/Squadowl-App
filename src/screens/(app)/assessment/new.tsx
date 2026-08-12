import { useEffect, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  ScrollView,
  Text,
  View,
  Keyboard,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateAssessmentFormSchema, SPORTS, EVENT_TYPES, type CreateAssessmentForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Chip, DateField, TimeField, Input, Screen, Header, ErrorState, LoadingState } from '@/components/ui';
import { useCreateTryoutMutation, useTeamsQuery, useTryoutsQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { useUser } from '@/state/authStore';
import { isAtAssessmentLimit } from '@/data/plans';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { buildLimitReachedMessage } from '@/lib/usageNudges';

export default function NewAssessmentScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const createTryout = useCreateTryoutMutation();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  // Neither platform's native resize is trustworthy here: iOS has no
  // window-resize equivalent to Android's adjustResize at all, and on
  // Android that manifest flag stopped actually shrinking the window once
  // targetSdk 36 enforced edge-to-edge (and it's flaky through
  // react-native-screens' native-stack Fragment hosting regardless) — so the
  // keyboard just overlapped the footer instead of the window resizing.
  // KeyboardAvoidingView's own "height"/"padding" behaviors rely on a
  // runtime view measurement call which — like the other runtime
  // measurement APIs this screen already works around below — is unreliable
  // under the New Architecture. Tracking the keyboard's own height straight
  // from the OS event instead, and applying it as padding ourselves on both
  // platforms, needs no view measurement or native resize at all. The
  // AndroidManifest's windowSoftInputMode is set to "adjustNothing" so the
  // OS never attempts its own resize/pan on top of this and double-shrinks.
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

  // The keyboardHeight padding above shrinks the visible area when the keyboard
  // opens, but it does NOT move the focused input — so tapping a field low in
  // the form (Location) leaves it below the shortened viewport, i.e. behind the keyboard.
  // Auto-scrolling the focused field to the top of the shrunken area is what
  // closes that gap. Positions are captured via onLayout instead of runtime
  // measurement APIs, which are unreliable under the New Architecture.
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

  const { control, handleSubmit, watch, setValue } = useForm<CreateAssessmentForm>({
    resolver: zodResolver(CreateAssessmentFormSchema),
    defaultValues: {
      name: '',
      sport: 'Hockey',
      eventType: 'Tryout',
      tryoutDate: '',
      startTime: '',
      endTime: '',
      rink: '',
      // Pre-linked when created from a team's Events section.
      teamId: route.params?.teamId,
    },
  });

  const sport = watch('sport');
  const eventType = watch('eventType');
  const teamId = watch('teamId');

  const onSubmit = handleSubmit(async (data) => {
    const count = tryoutsQuery.data?.length ?? 0;
    if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'assessments', 'assessments'));
      return;
    }
    const tryout = await createTryout.mutateAsync(data);
    setCurrentTryout(tryout.id);
    navigation.replace('AssessmentFlow', { screen: 'AssessmentSettings', params: { id: tryout.id, welcome: 1 } });
  });

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="New Assessment" showBack />
        <ErrorState
          message="Could not load required data."
          onRetry={() => {
            teamsQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  return (
    // scroll={false} + keyboardAvoiding={false}: the shared Screen's scroll mode
    // goes through react-native-keyboard-aware-scroll-view, whose auto-scroll-
    // above-keyboard logic relies on legacy measurement APIs (UIManager.measureInWindow,
    // findNodeHandle, TextInput.State.currentlyFocusedField) that are unreliable
    // under the New Architecture (this app has newArchEnabled=true) — the keyboard
    // was covering Start Time/Location with no scroll ever triggering. This screen
    // manages its own keyboard avoidance + plain ScrollView instead (see
    // keyboardHeight below), using only the raw Keyboard event API, so it
    // doesn't depend on any runtime view-measurement APIs at all.
    <Screen scroll={false} keyboardAvoiding={false} padded={false}>
      <View style={{ flex: 1, paddingBottom: keyboardHeight }}>
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <Header title="New Assessment" showBack />
          <View
            className="gap-4 mt-2"
            onLayout={(e) => {
              formTopRef.current = e.nativeEvent.layout.y;
            }}
          >
            <View onLayout={rememberField('name')}>
              <Controller
                control={control}
                name="name"
                render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
                  <Input
                    label="Assessment Name"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={error?.message}
                    placeholder="Spring U14 Tryout"
                    returnKeyType="done"
                    onFocus={revealField('name')}
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                )}
              />
            </View>

            <View>
              <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
                Sport
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {SPORTS.map((s) => (
                  <Chip key={s} label={s} active={sport === s} onPress={() => setValue('sport', s)} />
                ))}
              </ScrollView>
            </View>

            <View>
              <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
                Event Type
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {EVENT_TYPES.map((t) => (
                  <Chip key={t} label={t} active={eventType === t} onPress={() => setValue('eventType', t)} />
                ))}
              </ScrollView>
            </View>

            {teamsQuery.data && teamsQuery.data.length > 0 ? (
              <View>
                <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
                  Team (optional)
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {teamsQuery.data.map((team) => (
                    <Chip
                      key={team.id}
                      label={team.name}
                      active={teamId === team.id}
                      onPress={() =>
                        setValue('teamId', teamId === team.id ? undefined : team.id)
                      }
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Controller
              control={control}
              name="tryoutDate"
              render={({ field: { onChange, value } }) => (
                <DateField label="Date" value={value} onChange={onChange} placeholder="Select a date" />
              )}
            />
            <Controller
              control={control}
              name="startTime"
              render={({ field: { onChange, value } }) => (
                <TimeField label="Start Time" value={value} onChange={onChange} placeholder="Select a time" />
              )}
            />
            <Controller
              control={control}
              name="endTime"
              render={({ field: { onChange, value } }) => (
                <TimeField label="End Time" value={value} onChange={onChange} placeholder="Select a time" />
              )}
            />
            <View onLayout={rememberField('rink')}>
              <Controller
                control={control}
                name="rink"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Location"
                    placeholder="Field A"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    returnKeyType="done"
                    onFocus={revealField('rink')}
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                )}
              />
            </View>
          </View>
        </ScrollView>
        <View
          className="px-4 pt-3 border-t"
          style={{
            backgroundColor: colors.card,
            borderColor: colors.border,
            paddingBottom: Math.max(12, insets.bottom),
          }}
        >
          <Button label="Create Assessment" onPress={onSubmit} loading={createTryout.isPending} />
        </View>
      </View>
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
