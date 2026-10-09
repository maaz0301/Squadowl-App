import { View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegistrationSubmitSchema, type RegistrationSubmit } from '@/data/types';
import { BirthDateField, Button, Input } from '@/components/ui';
import { sportProfile } from '@/data/sportProfile';

interface Props {
  loading?: boolean;
  /** The evaluation's sport; a sport without positions does not ask for one. */
  sport?: string | null;
  onSubmit: (data: RegistrationSubmit) => Promise<void>;
}

export function RegistrationForm({ loading, sport, onSubmit }: Props) {
  const { control, handleSubmit, watch, setValue } = useForm<RegistrationSubmit>({
    resolver: zodResolver(RegistrationSubmitSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      yearOfBirth: '',
      dateOfBirth: '',
      playerEmail: '',
      guardianName: '',
      guardianEmail: '',
    },
  });

  return (
    <View className="gap-3 pb-4">
      <Controller
        control={control}
        name="firstName"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="First Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="lastName"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Last Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="yearOfBirth"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <BirthDateField
            label="Date of Birth"
            year={value}
            dateOfBirth={watch('dateOfBirth') ?? ''}
            onChange={({ year, dateOfBirth }) => {
              onChange(year);
              setValue('dateOfBirth', dateOfBirth);
            }}
            error={error?.message}
          />
        )}
      />
      {sportProfile(sport).positions ? (
        <Controller
          control={control}
          name="positionTryingOutFor"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Position" onBlur={onBlur} onChangeText={onChange} value={value} />
          )}
        />
      ) : null}
      <Controller
        control={control}
        name="playerEmail"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Player Email" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} autoCapitalize="none" keyboardType="email-address" />
        )}
      />
      <Controller
        control={control}
        name="guardianName"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Guardian Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="guardianEmail"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Guardian Email" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} autoCapitalize="none" />
        )}
      />
      <Controller
        control={control}
        name="guardianPhone"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Guardian Phone" onBlur={onBlur} onChangeText={(t) => { if (t.replace(/\D/g, '').length <= 15) onChange(t); }} value={value} keyboardType="phone-pad" />
        )}
      />
      <Button label="Submit Registration" onPress={handleSubmit(onSubmit)} loading={loading} />
    </View>
  );
}
