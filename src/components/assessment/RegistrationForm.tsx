import { View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegistrationSubmitSchema, type RegistrationSubmit } from '@/data/types';
import { Button, Input } from '@/components/ui';

interface Props {
  loading?: boolean;
  onSubmit: (data: RegistrationSubmit) => Promise<void>;
}

export function RegistrationForm({ loading, onSubmit }: Props) {
  const { control, handleSubmit } = useForm<RegistrationSubmit>({
    resolver: zodResolver(RegistrationSubmitSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      yearOfBirth: '',
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
          <Input label="Year of Birth" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} keyboardType="number-pad" placeholder="YYYY" />
        )}
      />
      <Controller
        control={control}
        name="positionTryingOutFor"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Position" onBlur={onBlur} onChangeText={onChange} value={value} />
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
