import { useState } from 'react';
import { Text, View } from 'react-native';
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
    <Screen scroll>
      <Header title="Team Feedback Survey" subtitle="Help us improve" showBack />
      <Card className="mt-4 gap-2">
        <Text style={{ color: colors.inkMuted }}>
          Rate your experience with assessments, scoring, and Team Hub.
        </Text>
        <RatingRow label="Overall experience" value={overallExperience} onChange={setOverallExperience} />
        <RatingRow label="Ease of use" value={easeOfUse} onChange={setEaseOfUse} />
        <RatingRow label="Team Hub & scheduling" value={teamHubScheduling} onChange={setTeamHubScheduling} />
        <RatingRow label="Value for money" value={valueForMoney} onChange={setValueForMoney} />
        <Input
          label="What's working well?"
          value={whatIsWorkingWell}
          onChangeText={setWhatIsWorkingWell}
          multiline
          numberOfLines={3}
        />
        <Input
          label="What can be improved?"
          value={whatCanBeImproved}
          onChangeText={setWhatCanBeImproved}
          multiline
          numberOfLines={3}
        />
        <Button label="Submit Feedback" onPress={handleSubmit} loading={submit.isPending} />
      </Card>
    </Screen>
  );
}
