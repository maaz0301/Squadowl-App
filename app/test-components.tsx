import React, { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Screen, Header, Card } from '@/components/ui';
import { TimedAssessment } from '@/components/assessment/TimedAssessment';
import { MeasurementAssessment } from '@/components/assessment/MeasurementAssessment';

export default function TestComponentsScreen() {
  const [time, setTime] = useState<number>();
  const [distance, setDistance] = useState<number>();

  return (
    <Screen scroll>
      <Header title="Component Testing" showBack={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Card title="1. Timed Assessment Component">
          <TimedAssessment 
            label="40-Yard Dash (Seconds)" 
            value={time} 
            onChange={setTime} 
          />
        </Card>

        <Card title="2. Measurement Assessment Component">
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
