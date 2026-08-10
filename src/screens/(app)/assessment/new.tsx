import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
  Keyboard,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

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

export default function NewAssessmentScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const createTryout = useCreateTryoutMutation();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  // KeyboardAvoidingView shrinks the visible area when the keyboard opens, but
  // it does NOT move the focused input — so tapping a field low in the form
  // (Location) leaves it below the shortened viewport, i.e. behind the keyboard.
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
      setLimitMsg('You have reached the maximum number of assessments for your current plan.');
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
    // manages its own KeyboardAvoidingView + plain ScrollView instead, using only
    // core RN APIs, so it doesn't depend on that library's internals at all.
    <Screen scroll={false} keyboardAvoiding={false} padded={false}>
      {/*
        iOS has no adjustResize equivalent, so KeyboardAvoidingView has to shrink
        the view itself ("height"). On Android the manifest already sets
        windowSoftInputMode="adjustResize", which shrinks the window natively —
        applying "height" on top of that shrinks it twice and leaves the form a
        keyboard-height too short, so Android deliberately gets no behavior.
      */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'height' : undefined}>
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 260 }}
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

            <Button label="Create Assessment" onPress={onSubmit} loading={createTryout.isPending} className="mt-2" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
