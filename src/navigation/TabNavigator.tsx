import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

import DashboardStack from './DashboardStack';
import SearchScreen from '../screens/(app)/search';
import ProfileScreen from '../screens/(app)/profile';

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  const colors = useThemeColors();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardStack}
        options={{
          title: 'Home',
          tabBarIcon: ({ size }) => <Text style={{ fontSize: size }}>🏠</Text>,
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          title: 'Search',
          tabBarIcon: ({ size }) => <Text style={{ fontSize: size }}>🔍</Text>,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Profile',
          tabBarIcon: ({ size }) => <Text style={{ fontSize: size }}>👤</Text>,
        }}
      />
    </Tab.Navigator>
  );
}
