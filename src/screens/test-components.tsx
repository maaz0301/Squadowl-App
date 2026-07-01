import React, { useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { Screen, Header, Card } from '@/components/ui';
import { TimedAssessment } from '@/components/assessment/TimedAssessment';
import { MeasurementAssessment } from '@/components/assessment/MeasurementAssessment';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function TestComponentsScreen() {
  const [time, setTime] = useState<number>();
  const [distance, setDistance] = useState<number>();
  const colors = useThemeColors();

  return (
    <Screen scroll>
      <Header title="Component Testing" showBack={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Card>
          <Text className="text-base font-bold mb-3" style={{ color: colors.ink }}>
            1. Timed Assessment Component
          </Text>
          <TimedAssessment 
            label="40-Yard Dash (Seconds)" 
            value={time} 
            onChange={setTime} 
          />
        </Card>

        <Card>
          <Text className="text-base font-bold mb-3" style={{ color: colors.ink }}>
            2. Measurement Assessment Component
          </Text>
          <MeasurementAssessment 
            label="Broad Jump" 
            unit="inches"
            value={distance} 
            onChange={setDistance} 
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}
