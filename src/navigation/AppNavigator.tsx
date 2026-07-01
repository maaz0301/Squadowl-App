import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// Root app navigator

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={require('./TabNavigator').default} />
    </Stack.Navigator>
  );
}
