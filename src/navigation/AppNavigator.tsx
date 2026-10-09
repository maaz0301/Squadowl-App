import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screens
import DashboardScreen from '../screens/(app)/dashboard';
import SearchScreen from '../screens/(app)/search';
import ProfileScreen from '../screens/(app)/profile';
import AssessmentTabNavigator from './AssessmentTabNavigator';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* Main screens */}
      <Stack.Screen name="DashboardMain" component={DashboardScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />

      {/* Assessment flow (has its own bottom tabs) */}
      <Stack.Screen name="AssessmentFlow" component={AssessmentTabNavigator} />

      {/* Assessment standalone screens */}
      <Stack.Screen name="NewAssessment" component={require('../screens/(app)/assessment/new').default} />

      {/* Season screens */}
      <Stack.Screen name="SeasonSettings" component={require('../screens/(app)/season/[id]/settings').default} />
      <Stack.Screen name="NewSeason" component={require('../screens/(app)/season/new').default} />
      <Stack.Screen name="SeasonDetail" component={require('../screens/(app)/season/[id]/index').default} />
      <Stack.Screen name="SeasonAttendance" component={require('../screens/(app)/season/[id]/attendance').default} />
      <Stack.Screen name="SeasonAvailability" component={require('../screens/(app)/season/[id]/availability').default} />
      <Stack.Screen name="SeasonSchedule" component={require('../screens/(app)/season/[id]/schedule').default} />
      <Stack.Screen name="SeasonCalendar" component={require('../screens/(app)/season/[id]/calendar').default} />
      <Stack.Screen name="SeasonRoster" component={require('../screens/(app)/season/[id]/roster').default} />
      <Stack.Screen name="SeasonPlayer" component={require('../screens/(app)/season/[id]/player/[playerId]').default} />

      {/* Team screens */}
      <Stack.Screen name="NewTeam" component={require('../screens/(app)/team/new').default} />
      <Stack.Screen name="TeamDetail" component={require('../screens/(app)/team/[id]').default} />
      <Stack.Screen name="TeamPlayer" component={require('../screens/(app)/team/[id]/player/[playerId]').default} />
      <Stack.Screen name="TeamRegistrations" component={require('../screens/(app)/team/[id]/registrations').default} />
      <Stack.Screen name="TeamChat" component={require('../screens/(app)/team-chat').default} />

      {/* Player profile (standalone, athlete-identity-keyed) */}
      <Stack.Screen name="PlayerProfile" component={require('../screens/(app)/player/[athleteId]').default} />

      {/* Misc screens */}
      <Stack.Screen name="Upgrade" component={require('../screens/(app)/upgrade').default} />
      <Stack.Screen name="Payments" component={require('../screens/(app)/payments').default} />
      <Stack.Screen name="ArchivedAssessments" component={require('../screens/(app)/archived-assessments').default} />
      <Stack.Screen name="Feedback" component={require('../screens/(app)/feedback').default} />
      <Stack.Screen name="FeedbackReports" component={require('../screens/(app)/feedback-reports').default} />
      <Stack.Screen name="Loyalty" component={require('../screens/(app)/loyalty').default} />
      <Stack.Screen name="Enterprise" component={require('../screens/(app)/enterprise').default} />
      <Stack.Screen name="OrganizationMembers" component={require('../screens/(app)/organization/members').default} />
      <Stack.Screen name="Admin" component={require('../screens/(app)/admin').default} />
      <Stack.Screen name="Combine" component={require('../screens/(app)/combine').default} />
      <Stack.Screen name="Calendar" component={require('../screens/(app)/calendar').default} />
      <Stack.Screen name="Library" component={require('../screens/(app)/library').default} />
      <Stack.Screen name="Reports" component={require('../screens/(app)/reports').default} />
      <Stack.Screen name="GuardianPortal" component={require('../screens/(app)/guardian/[playerId]').default} />
      <Stack.Screen name="GuardianAssessmentDetails" component={require('../screens/(app)/guardian/assessment').default} />

      {/* Guardian -> Coach athlete profile sharing */}
      <Stack.Screen name="ShareDirectory" component={require('../screens/(app)/guardian/share-directory').default} />
      <Stack.Screen name="ShareDetail" component={require('../screens/(app)/share/[shareId]').default} />
      <Stack.Screen name="AthleteHub" component={require('../screens/(app)/athlete-hub/index').default} />
    </Stack.Navigator>
  );
}
