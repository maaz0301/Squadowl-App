import React from 'react';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { Text, Pressable, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useTryoutQuery, useRegistrationsQuery, useTryoutRealtimeSync } from '@/features/queries';

import AssessmentRosterScreen from '../screens/(app)/assessment/[id]/roster';
import AssessmentRegistrationsScreen from '../screens/(app)/assessment/[id]/registrations';
import AssessmentResultsScreen from '../screens/(app)/assessment/[id]/results';
import AssessmentSettingsScreen from '../screens/(app)/assessment/[id]/settings';
import AssessmentExportScreen from '../screens/(app)/assessment/[id]/export';
import AssessmentRubricsScreen from '../screens/(app)/assessment/[id]/rubrics';

import AssessmentPlayerScreen from '../screens/(app)/assessment/[id]/player/[playerId]';
import AssessmentScoreScreen from '../screens/(app)/assessment/[id]/score/[playerId]';
import AssessmentRinksideScreen from '../screens/(app)/assessment/[id]/rinkside';
import AssessmentTeamBuilderScreen from '../screens/(app)/assessment/[id]/team-builder';
import AssessmentCompareScreen from '../screens/(app)/assessment/[id]/compare';
import AssessmentRosterLibraryScreen from '../screens/(app)/assessment/[id]/roster-library';
import AssessmentScanSheetScreen from '../screens/(app)/assessment/[id]/scan-sheet';

const Tab = createBottomTabNavigator();

function TabIcon({ label, color, focused }: { label: string; color: string; focused: boolean }) {
  const colors = useThemeColors();
  return (
    <View style={{
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: focused ? colors.primary + '18' : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Text style={{
        fontSize: 15,
        fontWeight: '800',
        color: focused ? colors.primary : color,
      }}>
        {label}
      </Text>
    </View>
  );
}

export default function AssessmentTabNavigator() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  
  // Extract ID from the nested params or directly
  const id = route.params?.params?.id || route.params?.id;
  
  // Enable Real-Time Sync across all assessment screens
  useTryoutRealtimeSync(id);
  
  const [assessorState, setAssessorState] = React.useState(() => {
    return route.params?.params?.isAssessorOnly || route.params?.isAssessorOnly || false;
  });

  React.useEffect(() => {
    const incoming = route.params?.params?.isAssessorOnly || route.params?.isAssessorOnly;
    if (incoming !== undefined) {
      setAssessorState(incoming);
    }
  }, [route.params]);

  const isAssessorOnly = assessorState;
  
  const tryoutQuery = useTryoutQuery(id);
  const tryout = tryoutQuery.data;

  const regsQuery = useRegistrationsQuery(id!);
  const pendingRegs = (regsQuery.data ?? []).filter(r => r.status === 'pending').length;

  return (
    <Tab.Navigator
      tabBar={props => {
        const state = props.state;
        const activeRoute = state.routes[state.index];
        const isRosterSubScreen = [
          'AssessmentPlayer',
          'AssessmentScore',
          'AssessmentRinkside',
          'AssessmentTeamBuilder',
          'AssessmentCompare',
          'AssessmentRosterLibrary',
          'AssessmentScanSheet'
        ].includes(activeRoute.name);

        if (isRosterSubScreen) {
          const rosterIndex = state.routes.findIndex(r => r.name === 'AssessmentRoster');
          if (rosterIndex !== -1) {
            const newState = { ...state, index: rosterIndex };
            return <BottomTabBar {...props} state={newState} />;
          }
        }
        return <BottomTabBar {...props} />;
      }}
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.bgSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: 'SpaceGrotesk-Bold', fontSize: 17 },
        tabBarStyle: {
          backgroundColor: colors.bgSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          height: 56 + insets.bottom,
          paddingBottom: Math.max(6, insets.bottom),
          paddingTop: 6,
          paddingHorizontal: 0,
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: 9, fontWeight: '700', marginTop: 2 },
        tabBarItemStyle: { paddingHorizontal: 2, minWidth: 0, flex: 1 },
        headerLeft: () => (
          <Pressable
            onPress={() => {
              const parent = navigation.getParent();
              if (parent?.canGoBack()) {
                parent.goBack();
              } else if (navigation.canGoBack()) {
                navigation.goBack();
              }
            }}
            style={{
              marginLeft: 16,
              marginRight: 8,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="M15 19l-7-7 7-7"
                stroke={colors.ink}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        ),
      }}
    >
      <Tab.Screen
        name="AssessmentRoster"
        component={AssessmentRosterScreen}
        initialParams={{ id }}
        options={{
          title: tryout?.name || 'Loading...',
          tabBarLabel: 'Roster',
          tabBarIcon: ({ color, focused }) => <TabIcon label="R" color={color} focused={focused} />,
        }}
      />
      {!isAssessorOnly && (
        <Tab.Screen
          name="AssessmentRegistrations"
          component={AssessmentRegistrationsScreen}
          initialParams={{ id }}
          options={{
            title: tryout?.name || 'Loading...',
            tabBarLabel: 'Regs',
            tabBarBadge: pendingRegs > 0 ? pendingRegs : undefined,
            tabBarIcon: ({ color, focused }) => <TabIcon label="Q" color={color} focused={focused} />,
          }}
        />
      )}
      <Tab.Screen
        name="AssessmentResults"
        component={AssessmentResultsScreen}
        initialParams={{ id, isAssessorOnly }}
        options={{
          title: tryout?.name || 'Loading...',
          tabBarLabel: 'Results',
          tabBarIcon: ({ color, focused }) => <TabIcon label="∑" color={color} focused={focused} />,
        }}
      />
      {!isAssessorOnly && (
        <Tab.Screen
          name="AssessmentSettings"
          component={AssessmentSettingsScreen}
          initialParams={{ id }}
          options={{
            title: tryout?.name || 'Loading...',
            tabBarLabel: 'Settings',
            tabBarIcon: ({ color, focused }) => <TabIcon label="⚙" color={color} focused={focused} />,
          }}
        />
      )}
      {!isAssessorOnly && (
        <Tab.Screen
          name="AssessmentExport"
          component={AssessmentExportScreen}
          initialParams={{ id }}
          options={{
            title: tryout?.name || 'Loading...',
            tabBarLabel: 'Export',
            tabBarIcon: ({ color, focused }) => <TabIcon label="↑" color={color} focused={focused} />,
          }}
        />
      )}
      {!isAssessorOnly && (
        <Tab.Screen
          name="AssessmentRubrics"
          component={AssessmentRubricsScreen}
          initialParams={{ id }}
          options={{
            title: tryout?.name || 'Loading...',
            tabBarLabel: 'Rubrics',
            tabBarIcon: ({ color, focused }) => <TabIcon label="≡" color={color} focused={focused} />,
          }}
        />
      )}

      {/* Hidden Screens (still in the tab context but no tab button) */}
      <Tab.Screen name="AssessmentPlayer" component={AssessmentPlayerScreen} initialParams={{ id }} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
      <Tab.Screen name="AssessmentScore" component={AssessmentScoreScreen} initialParams={{ id }} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
      <Tab.Screen name="AssessmentRinkside" component={AssessmentRinksideScreen} initialParams={{ id }} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
      <Tab.Screen name="AssessmentTeamBuilder" component={AssessmentTeamBuilderScreen} initialParams={{ id }} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
      <Tab.Screen name="AssessmentCompare" component={AssessmentCompareScreen} initialParams={{ id }} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
      <Tab.Screen name="AssessmentRosterLibrary" component={AssessmentRosterLibraryScreen} initialParams={{ id }} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
      <Tab.Screen name="AssessmentScanSheet" component={AssessmentScanSheetScreen} initialParams={{ id }} options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' }, headerShown: false }} />
    </Tab.Navigator>
  );
}
