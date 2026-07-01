import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DashboardScreen from '../screens/(app)/dashboard';
import SettingsScreen from '../screens/(app)/season/[id]/settings';
import AssessmentRegistrationsScreen from '../screens/(app)/assessment/[id]/registrations';
import AssessmentRosterScreen from '../screens/(app)/assessment/[id]/roster';
import AssessmentScanSheetScreen from '../screens/(app)/assessment/[id]/scan-sheet';
import AssessmentRinksideScreen from '../screens/(app)/assessment/[id]/rinkside';
import AssessmentResultsScreen from '../screens/(app)/assessment/[id]/results';

const Stack = createNativeStackNavigator();

export default function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DashboardMain" component={DashboardScreen} />
      <Stack.Screen name="SeasonSettings" component={SettingsScreen} />
      <Stack.Screen name="AssessmentRegistrations" component={AssessmentRegistrationsScreen} />
      <Stack.Screen name="AssessmentRoster" component={AssessmentRosterScreen} />
      <Stack.Screen name="AssessmentScanSheet" component={AssessmentScanSheetScreen} />
      <Stack.Screen name="AssessmentRinkside" component={AssessmentRinksideScreen} />
      <Stack.Screen name="AssessmentResults" component={AssessmentResultsScreen} />
      <Stack.Screen name="Upgrade" component={require('../screens/(app)/upgrade').default} />
      <Stack.Screen name="ArchivedAssessments" component={require('../screens/(app)/archived-assessments').default} />
      <Stack.Screen name="Feedback" component={require('../screens/(app)/feedback').default} />
      <Stack.Screen name="FriendPackages" component={require('../screens/(app)/friend-packages').default} />
      <Stack.Screen name="Enterprise" component={require('../screens/(app)/enterprise').default} />
      <Stack.Screen name="Admin" component={require('../screens/(app)/admin').default} />
      <Stack.Screen name="NewTeam" component={require('../screens/(app)/team/new').default} />
      <Stack.Screen name="TeamDetail" component={require('../screens/(app)/team/[id]').default} />
      <Stack.Screen name="NewAssessment" component={require('../screens/(app)/assessment/new').default} />
      <Stack.Screen name="AssessmentSettings" component={require('../screens/(app)/assessment/[id]/settings').default} />
      <Stack.Screen name="AssessmentRosterLibrary" component={require('../screens/(app)/assessment/[id]/roster-library').default} />
      <Stack.Screen name="AssessmentRubrics" component={require('../screens/(app)/assessment/[id]/rubrics').default} />
      <Stack.Screen name="AssessmentExport" component={require('../screens/(app)/assessment/[id]/export').default} />
      <Stack.Screen name="AssessmentCompare" component={require('../screens/(app)/assessment/[id]/compare').default} />
      <Stack.Screen name="AssessmentTeamBuilder" component={require('../screens/(app)/assessment/[id]/team-builder').default} />
      <Stack.Screen name="AssessmentPlayer" component={require('../screens/(app)/assessment/[id]/player/[playerId]').default} />
      <Stack.Screen name="AssessmentScore" component={require('../screens/(app)/assessment/[id]/score/[playerId]').default} />
      <Stack.Screen name="Combine" component={require('../screens/(app)/combine').default} />
      <Stack.Screen name="NewSeason" component={require('../screens/(app)/season/new').default} />
      <Stack.Screen name="SeasonDetail" component={require('../screens/(app)/season/[id]/index').default} />
      <Stack.Screen name="SeasonAttendance" component={require('../screens/(app)/season/[id]/attendance').default} />
      <Stack.Screen name="SeasonAvailability" component={require('../screens/(app)/season/[id]/availability').default} />
      <Stack.Screen name="SeasonSchedule" component={require('../screens/(app)/season/[id]/schedule').default} />
      <Stack.Screen name="SeasonCalendar" component={require('../screens/(app)/season/[id]/calendar').default} />
      <Stack.Screen name="SeasonRoster" component={require('../screens/(app)/season/[id]/roster').default} />
      <Stack.Screen name="SeasonPlayer" component={require('../screens/(app)/season/[id]/player/[playerId]').default} />
    </Stack.Navigator>
  );
}
