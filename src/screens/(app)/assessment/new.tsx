import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  Switch,
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
import { z } from 'zod';
import {
  CreateAssessmentFormSchema,
  SPORTS,
  EVENT_TYPES,
  type CreateAssessmentForm,
  type Assessor,
  type CustomRubric,
  type ScoringType,
  type RankingDirection,
} from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Chip, DateField, TimeField, Input, Modal, Screen, Header, ErrorState, LoadingState } from '@/components/ui';
import { useCreateTryoutMutation, useTeamsQuery, useTryoutSummariesQuery, useUpdateTryoutMutation } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { useUser } from '@/state/authStore';
import { isAtAssessmentLimit } from '@/data/plans';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { getDataSource } from '@/data';
import { ASSESSOR_INVITE_URL } from '@/config/app';

const SCORING_TYPE_LABEL: Record<ScoringType, string> = {
  skill: 'Skill / Technique',
  time: 'Time-based',
  distance: 'Distance-based',
  speed: 'Speed-based',
};

export default function NewAssessmentScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const createTryout = useCreateTryoutMutation();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const teamsQuery = useTeamsQuery();
  // Only `.length` is read from this, for the plan-limit check — the full
  // read pulled every roster, evaluation and registration in the account to
  // get a number. See useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const user = useUser();
  const updateTryout = useUpdateTryoutMutation();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  // Rubrics and assessors used to only be reachable on the settings screen
  // after creation — a second step for something coaches expect to finish in
  // one go. Both are collected here instead and applied right after the
  // tryout row exists (they're keyed to a tryout id, so neither can be
  // written before that). Mirrors the web create-assessment screen.
  const [pendingAssessors, setPendingAssessors] = useState<Assessor[]>([]);
  const [showAssessorForm, setShowAssessorForm] = useState(false);
  const [assessorName, setAssessorName] = useState('');
  const [assessorEmail, setAssessorEmail] = useState('');

  const [pendingRubrics, setPendingRubrics] = useState<CustomRubric[]>([]);
  const [showRubricForm, setShowRubricForm] = useState(false);
  const [rubricLabel, setRubricLabel] = useState('');
  const [rubricType, setRubricType] = useState<ScoringType>('skill');
  const [rubricScale, setRubricScale] = useState<'1-5' | '1-10'>('1-5');
  const [rubricUnit, setRubricUnit] = useState('');
  const [rubricMinStr, setRubricMinStr] = useState('');
  const [rubricMaxStr, setRubricMaxStr] = useState('');
  const [rubricRankingDirection, setRubricRankingDirection] = useState<RankingDirection>('higher_is_better');

  const handleRubricTypeChange = (type: ScoringType) => {
    setRubricType(type);
    setRubricRankingDirection(type === 'time' ? 'lower_is_better' : 'higher_is_better');
  };

  const addAssessorToList = async () => {
    const name = assessorName.trim();
    const email = assessorEmail.trim();
    if (!name || !email) {
      Alert.alert('Missing Info', 'An assessor needs both a name and an email address.');
      return;
    }
    if (!z.string().email().safeParse(email).success) {
      Alert.alert('Invalid Email', `"${email}" is not a valid email address.`);
      return;
    }
    // One row per address per tryout — the same constraint the settings screen
    // guards, caught here before the list is even submitted.
    if (pendingAssessors.some((a: any) => a.email?.toLowerCase() === email.toLowerCase())) {
      Alert.alert('Already Added', `${email} is already on this evaluation's assessor list.`);
      return;
    }
    // No account-exists check: the invite is claimed by email address whenever
    // that person signs up (handle_new_user in 0002_assessor_linking.sql), so
    // an assessor who isn't registered yet is invited, not rejected.
    setPendingAssessors((prev) => [...prev, { name, email, role: 'assessor', status: 'pending' }]);
    setAssessorName('');
    setAssessorEmail('');
    setShowAssessorForm(false);
  };

  const removeAssessorFromList = (index: number) => {
    setPendingAssessors((prev) => prev.filter((_, i) => i !== index));
  };

  const addRubricToList = () => {
    const label = rubricLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/\s+/g, '_');
    if (pendingRubrics.some((r) => r.key === key)) {
      Alert.alert('Duplicate Rubric', 'A rubric with this name has already been added.');
      return;
    }

    let defaultUnit = rubricUnit.trim();
    if (rubricType === 'time') {
      if (!defaultUnit) defaultUnit = 'sec';
    } else if (rubricType === 'distance') {
      if (!defaultUnit) defaultUnit = 'ft';
    } else if (rubricType === 'speed') {
      if (!defaultUnit) defaultUnit = 'mph';
    }
    const minNum = rubricMinStr.trim() !== '' ? parseFloat(rubricMinStr) : undefined;
    const maxNum = rubricMaxStr.trim() !== '' ? parseFloat(rubricMaxStr) : undefined;

    setPendingRubrics((prev) => [
      ...prev,
      {
        key,
        label,
        scoringType: rubricType,
        scale: rubricType === 'skill' ? rubricScale : '1-5',
        unit: rubricType !== 'skill' ? defaultUnit : undefined,
        minVal: minNum != null && !isNaN(minNum) ? minNum : undefined,
        maxVal: maxNum != null && !isNaN(maxNum) ? maxNum : undefined,
        rankingDirection: rubricRankingDirection,
      },
    ]);
    setRubricLabel('');
    setRubricType('skill');
    setRubricScale('1-5');
    setRubricUnit('');
    setRubricMinStr('');
    setRubricMaxStr('');
    setRubricRankingDirection('higher_is_better');
    setShowRubricForm(false);
  };

  const removeRubricFromList = (key: string) => {
    setPendingRubrics((prev) => prev.filter((r) => r.key !== key));
  };

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
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'assessments', 'evaluations'));
      return;
    }
    let tryout;
    try {
      tryout = await createTryout.mutateAsync(data);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create the evaluation.');
      return;
    }
    setCurrentTryout(tryout.id);

    if (pendingAssessors.length || pendingRubrics.length) {
      try {
        const updated = await updateTryout.mutateAsync({
          id: tryout.id,
          updates: {
            ...(pendingAssessors.length ? { assessors: pendingAssessors } : {}),
            ...(pendingRubrics.length
              ? { settings: { ...tryout.settings, customRubrics: pendingRubrics } }
              : {}),
          },
        });
        // Best-effort: the assessment and its assessor list are already saved,
        // so a failed invite email shouldn't block the coach from moving on —
        // they can still resend from the settings screen.
        for (const a of updated.assessors) {
          // `role !== 'lead'` skips the creator's own seeded row — otherwise
          // every coach mailed themselves an "you've been assigned as an
          // assessor" note for the assessment they had just made.
          if (!a.email || a.role === 'lead') continue;
          try {
            await getDataSource().sendEmail('tryout_invite', a.email, {
              role: 'assessor',
              tryoutName: updated.name,
              inviteUrl: ASSESSOR_INVITE_URL,
            });
          } catch (err) {
            // console.warn, not console.error: this is the best-effort path above —
            // a failed invite email must stay silent in the background, not hijack
            // the screen with LogBox's full-screen error overlay.
            console.warn('Error sending assessor invite email', err);
          }
        }
      } catch (e: any) {
        Alert.alert(
          'Partial Save',
          `The assessment was created, but saving its rubrics/assessors failed: ${e?.message || 'Unknown error'}`,
        );
      }
    }

    navigation.replace('AssessmentFlow', { screen: 'AssessmentSettings', params: { id: tryout.id } });
  });

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="New Evaluation" showBack />
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
          <Header title="New Evaluation" showBack />
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
                    label="Evaluation Name"
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

            <View>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Custom Rubrics (optional)
                </Text>
                <Button label="+ Add Rubric" variant="ghost" size="sm" onPress={() => setShowRubricForm(true)} />
              </View>
              {pendingRubrics.length === 0 ? (
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Every sport already scores on a default set of skills — add one here only if this
                  evaluation needs something extra.
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {pendingRubrics.map((r) => (
                    <Chip key={r.key} label={`${r.label} ✕`} active onPress={() => removeRubricFromList(r.key)} />
                  ))}
                </View>
              )}
            </View>

            <View>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Assessors (optional)
                </Text>
                <Button label="+ Add Assessor" variant="ghost" size="sm" onPress={() => setShowAssessorForm(true)} />
              </View>
              {pendingAssessors.length === 0 ? (
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Invite whoever else is scoring — they get an email once the evaluation is created.
                </Text>
              ) : (
                <View className="gap-2">
                  {pendingAssessors.map((a, i) => (
                    <View
                      key={`${a.email}-${i}`}
                      className="flex-row items-center gap-2 rounded-xl px-3 py-2"
                      style={{ backgroundColor: colors.tile }}
                    >
                      <View className="flex-1">
                        <Text numberOfLines={1} className="text-sm font-bold" style={{ color: colors.ink }}>{a.name}</Text>
                        <Text numberOfLines={1} className="text-xs" style={{ color: colors.inkMuted }}>{a.email}</Text>
                      </View>
                      <Button label="Remove" variant="ghost" size="sm" onPress={() => removeAssessorFromList(i)} />
                    </View>
                  ))}
                </View>
              )}
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
          <Button label="Create Evaluation" onPress={onSubmit} loading={createTryout.isPending} />
        </View>
      </View>
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />

      <Modal
        visible={showRubricForm}
        title="Add Custom Drill / Category"
        onClose={() => setShowRubricForm(false)}
        footer={
          <View className="mt-4 gap-2">
            <Button label="Add Rubric Category" onPress={addRubricToList} disabled={!rubricLabel.trim()} />
          </View>
        }
      >
        <View className="gap-4">
          <Input
            label="1. Drill / Category Name"
            value={rubricLabel}
            onChangeText={setRubricLabel}
            placeholder="e.g. 40-Yard Dash, Long Throw, Shot Speed"
          />

          <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            2. Scoring Type
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {(Object.keys(SCORING_TYPE_LABEL) as ScoringType[]).map((t) => (
              <Chip key={t} label={SCORING_TYPE_LABEL[t]} active={rubricType === t} onPress={() => handleRubricTypeChange(t)} />
            ))}
          </View>

          {rubricType === 'skill' ? (
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                3. Scale Choice
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip label="1-5 Scale" active={rubricScale === '1-5'} onPress={() => setRubricScale('1-5')} />
                <Chip label="1-10 Scale" active={rubricScale === '1-10'} onPress={() => setRubricScale('1-10')} />
              </View>
              <Text className="text-xs italic" style={{ color: colors.inkMuted }}>
                Ranking Rule: Highest number = highest rank (Score 5)
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              <Input
                label="3. Unit Label (Free-form)"
                value={rubricUnit}
                onChangeText={setRubricUnit}
                placeholder={
                  rubricType === 'time' ? 'e.g. sec, s, min' : rubricType === 'speed' ? 'e.g. mph, km/h' : 'e.g. ft, m, inches'
                }
              />

              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                4. Ranking Rule
              </Text>
              <Pressable
                onPress={() =>
                  setRubricRankingDirection(rubricRankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')
                }
                className="flex-row items-center justify-between rounded-lg border px-4 py-3"
                style={{ borderColor: colors.border, backgroundColor: colors.field }}
              >
                <View className="flex-1 pr-3">
                  <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                    {rubricRankingDirection === 'lower_is_better' ? 'Lowest / Shortest wins' : 'Highest / Farthest wins'}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                    {rubricRankingDirection === 'lower_is_better'
                      ? 'Best performance = lowest value (e.g. fastest sprint)'
                      : 'Best performance = highest value (e.g. longest throw)'}
                  </Text>
                </View>
                <Switch
                  value={rubricRankingDirection === 'lower_is_better'}
                  onValueChange={(val) => setRubricRankingDirection(val ? 'lower_is_better' : 'higher_is_better')}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </Pressable>

              <Text className="text-xs font-bold uppercase tracking-wider mt-1" style={{ color: colors.inkMuted }}>
                5. Score Range Benchmarks (Min &amp; Max)
              </Text>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input
                    label="Min Value"
                    value={rubricMinStr}
                    onChangeText={setRubricMinStr}
                    keyboardType="numeric"
                    placeholder={rubricType === 'time' ? '12 (Best)' : '5 (Worst)'}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Max Value"
                    value={rubricMaxStr}
                    onChangeText={setRubricMaxStr}
                    keyboardType="numeric"
                    placeholder={rubricType === 'time' ? '25 (Worst)' : '25 (Best)'}
                  />
                </View>
              </View>

              <Text className="text-xs font-bold italic" style={{ color: colors.primary }}>
                Score Benchmark Rule:{' '}
                {rubricRankingDirection === 'lower_is_better'
                  ? `Min value (${rubricMinStr || '10'}) = 5.0 points (Best)  ·  Max value (${rubricMaxStr || '25'}) = 1.0 points (Worst)`
                  : `Min value (${rubricMinStr || '5'}) = 1.0 points (Worst)  ·  Max value (${rubricMaxStr || '25'}) = 5.0 points (Best)`}
              </Text>
            </View>
          )}
        </View>
      </Modal>

      <Modal
        visible={showAssessorForm}
        title="Add Assessor"
        onClose={() => setShowAssessorForm(false)}
        footer={
          <View className="mt-4 gap-2">
            <Button label="Add" onPress={addAssessorToList} disabled={!assessorName.trim() || !assessorEmail.trim()} />
          </View>
        }
      >
        <View className="gap-3">
          <Input label="Name" value={assessorName} onChangeText={setAssessorName} />
          <Input label="Email" value={assessorEmail} onChangeText={setAssessorEmail} autoCapitalize="none" keyboardType="email-address" />
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            They'll be emailed an invitation when the evaluation is created. If they don't have a TryoutHQ account
            yet, they can create one with this address and the invitation will be waiting for them.
          </Text>
        </View>
      </Modal>
    </Screen>
  );
}
