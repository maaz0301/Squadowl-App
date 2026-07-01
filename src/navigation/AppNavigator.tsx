import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardScreen from '../screens/(app)/dashboard';
import SearchScreen from '../screens/(app)/search';
import ProfileScreen from '../screens/(app)/profile';
import SettingsScreen from '../screens/(app)/season/[id]/settings';
import AssessmentRegistrationsScreen from '../screens/(app)/assessment/[id]/registrations';
import AssessmentRosterScreen from '../screens/(app)/assessment/[id]/roster';
import AssessmentScanSheetScreen from '../screens/(app)/assessment/[id]/scan-sheet';
import AssessmentRinksideScreen from '../screens/(app)/assessment/[id]/rinkside';
import AssessmentResultsScreen from '../screens/(app)/assessment/[id]/results';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="SeasonSettings" component={SettingsScreen} />
      <Stack.Screen name="AssessmentRegistrations" component={AssessmentRegistrationsScreen} />
      <Stack.Screen name="AssessmentRoster" component={AssessmentRosterScreen} />
      <Stack.Screen name="AssessmentScanSheet" component={AssessmentScanSheetScreen} />
      <Stack.Screen name="AssessmentRinkside" component={AssessmentRinksideScreen} />
      <Stack.Screen name="AssessmentResults" component={AssessmentResultsScreen} />
    </Stack.Navigator>
  );
}
