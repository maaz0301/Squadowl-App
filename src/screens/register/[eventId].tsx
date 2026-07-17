import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, Platform } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Screen, Header, Button, Input } from '@/components/ui';
import { SupabaseDataSource } from '@/data/supabase/SupabaseDataSource';
import { useThemeColors } from '@/theme/ThemeProvider';
import { RegistrationSubmitSchema, type RegistrationSubmit } from '@/data/types';

const ds = new SupabaseDataSource();

export default function PublicRegistration() {
  const route = useRoute<any>();
  const { eventId } = route.params || {};
  const colors = useThemeColors();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<RegistrationSubmit>({
    resolver: zodResolver(RegistrationSubmitSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      yearOfBirth: '',
      positionTryingOutFor: '',
      guardianName: '',
      guardianEmail: '',
      guardianPhone: '',
      currentTeam: '',
      currentLevel: '',
      aboutPlayer: '',
      medicalInfo: '',
      friend1Name: '',
      friend2Name: '',
    },
  });

  const onSubmit = async (data: RegistrationSubmit) => {
    if (!eventId || typeof eventId !== 'string') {
      Alert.alert('Error', 'Invalid event ID');
      return;
    }

    setIsSubmitting(true);
    try {
      await ds.submitPublicRegistration(eventId.toUpperCase(), data);
      
      if (data.guardianEmail) {
        try {
          await ds.sendEmail('registration_confirmation', data.guardianEmail, {
            playerName: `${data.firstName} ${data.lastName}`,
          });
        } catch (emailErr) {
          console.error('Failed to send confirmation email', emailErr);
          // Don't fail the registration if email fails
        }
      }
      
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      if (Platform.OS === 'web') {
        window.alert('Failed to register. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to register. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <Screen>
        <Header title="Registration Complete" />
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-2xl font-bold mb-4" style={{ color: colors.ink }}>
            You're registered!
          </Text>
          <Text className="text-center text-base" style={{ color: colors.inkMuted }}>
            Your information has been successfully submitted. You can now close this page and wait for further instructions from the event coordinator.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Event Registration" />
      <ScrollView className="flex-1 px-4 py-6" contentContainerStyle={{ gap: 16 }}>
        <Text className="text-lg font-bold" style={{ color: colors.ink }}>
          Register for Event
        </Text>
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          Please fill out the form below to register yourself for this event.
        </Text>

        <Controller
          control={control}
          name="firstName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="First Name" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.firstName?.message} placeholder="Enter first name" />
          )}
        />
        <Controller
          control={control}
          name="lastName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Last Name" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.lastName?.message} placeholder="Enter last name" />
          )}
        />
        <Controller
          control={control}
          name="positionTryingOutFor"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Position (FWD/DEF/GTL)" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.positionTryingOutFor?.message} autoCapitalize="characters" />
          )}
        />
        <Controller
          control={control}
          name="yearOfBirth"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Year of Birth" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.yearOfBirth?.message} keyboardType="number-pad" placeholder="YYYY" />
          )}
        />
        
        <View className="h-4" />
        <Text className="text-base font-bold" style={{ color: colors.ink }}>Guardian Information</Text>

        <Controller
          control={control}
          name="guardianName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Guardian Name" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.guardianName?.message} />
          )}
        />
        <Controller
          control={control}
          name="guardianEmail"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Guardian Email" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.guardianEmail?.message} autoCapitalize="none" keyboardType="email-address" />
          )}
        />
        <Controller
          control={control}
          name="guardianPhone"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Guardian Phone" onBlur={onBlur} onChangeText={(t) => { if (t.replace(/\D/g, '').length <= 15) onChange(t); }} value={value} error={errors.guardianPhone?.message} keyboardType="phone-pad" />
          )}
        />

        <View className="h-4" />
        <Text className="text-base font-bold" style={{ color: colors.ink }}>Additional Details</Text>

        <Controller
          control={control}
          name="currentTeam"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Current Team" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.currentTeam?.message} />
          )}
        />
        <Controller
          control={control}
          name="currentLevel"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Current Level" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.currentLevel?.message} />
          )}
        />
        <Controller
          control={control}
          name="aboutPlayer"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="About Player" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.aboutPlayer?.message} multiline numberOfLines={2} />
          )}
        />
        <Controller
          control={control}
          name="medicalInfo"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Medical Info" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.medicalInfo?.message} multiline numberOfLines={2} />
          )}
        />
        <Controller
          control={control}
          name="friend1Name"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Friend 1" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.friend1Name?.message} />
          )}
        />
        <Controller
          control={control}
          name="friend2Name"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Friend 2" onBlur={onBlur} onChangeText={onChange} value={value} error={errors.friend2Name?.message} />
          )}
        />

        <View className="mt-4 mb-10">
          <Button
            label={isSubmitting ? 'Registering...' : 'Complete Registration'}
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
