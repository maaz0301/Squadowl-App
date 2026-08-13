import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  Text,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Header, Input, Screen } from '@/components/ui';
import { useSubmitFeedbackMutation } from '@/features/queries';

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
  return (
    <View className="gap-2 mb-4">
      <Text className="font-bold" style={{ color: colors.ink }}>
        {label}
      </Text>
      <View className="flex-row gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            label={String(n)}
            size="sm"
            variant={value === n ? 'primary' : 'secondary'}
            onPress={() => onChange(n)}
          />
        ))}
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
              Rate your experience with assessments, scoring, and Team Hub.
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
            <Button label="Submit Feedback" onPress={handleSubmit} loading={submit.isPending} />
          </Card>
        </ScrollView>
      </View>
    </Screen>
  );
}
