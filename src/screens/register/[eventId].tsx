import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, Platform, Linking } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { EXPO_PUBLIC_WEB_URL } from '@env';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Screen, Header, Button, Input } from '@/components/ui';
import { SupabaseDataSource } from '@/data/supabase/SupabaseDataSource';
import { useThemeColors } from '@/theme/ThemeProvider';
import { RegistrationSubmitSchema, type RegistrationSubmit, type Registration } from '@/data/types';

const ds = new SupabaseDataSource();

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)} CAD`;
}

export default function PublicRegistration() {
  const route = useRoute<any>();
  const { eventId } = route.params || {};
  const colors = useThemeColors();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<Registration | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const alreadyPaid = Platform.OS === 'web' && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('paid') === '1';

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
      const registration = await ds.submitPublicRegistration(eventId.toUpperCase(), data);

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

      const feeCents = registration.registrationFeeCents ?? 0;
      if (feeCents > 0 && registration.connectChargesEnabled) {
        setPendingPayment(registration);
      } else {
        setIsSuccess(true);
      }
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

  const payNow = async () => {
    if (!pendingPayment) return;
    setIsPaying(true);
    try {
      const base = `${EXPO_PUBLIC_WEB_URL || 'https://aas-tryout.app'}/register/${eventId}`;
      const res = await ds.createRegistrationPayment(pendingPayment.id, `${base}?paid=1`, `${base}?paid=0`);
      if (res?.url) {
        if (Platform.OS === 'web') {
          window.location.href = res.url;
        } else {
          await Linking.openURL(res.url);
        }
      }
    } catch (err: any) {
      console.error(err);
      const message = err.message || 'Failed to start payment. Please try again.';
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Payment Error', message);
      }
    } finally {
      setIsPaying(false);
    }
  };

  if (alreadyPaid) {
    return (
      <Screen>
        <Header title="Payment Received" />
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-2xl font-bold mb-4" style={{ color: colors.ink }}>
            Payment complete!
          </Text>
          <Text className="text-center text-base" style={{ color: colors.inkMuted }}>
            Your registration fee has been received. You can now close this page.
          </Text>
        </View>
      </Screen>
    );
  }

  if (pendingPayment) {
    const feeCents = pendingPayment.registrationFeeCents ?? 0;
    return (
      <Screen>
        <Header title="Registration Fee" />
        <View className="flex-1 items-center justify-center p-4 gap-4">
          <Text className="text-2xl font-bold text-center" style={{ color: colors.ink }}>
            One step left
          </Text>
          <Text className="text-center text-base" style={{ color: colors.inkMuted }}>
            {pendingPayment.firstName} {pendingPayment.lastName} is registered. Complete payment
            of {money(feeCents)} to confirm the spot.
          </Text>
          <Button label={isPaying ? 'Redirecting...' : `Pay ${money(feeCents)}`} onPress={payNow} disabled={isPaying} />
        </View>
      </Screen>
    );
  }

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
    <Screen scroll>
      <Header title="Event Registration" />
      <View className="gap-4 py-4">
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
      </View>
    </Screen>
  );
}
