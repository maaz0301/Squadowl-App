import { View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AddPlayerFormSchema, type AddPlayerForm as AddPlayerFormType } from '@/data/types';
import { Button, Input } from '@/components/ui';

interface Props {
  loading?: boolean;
  defaultValues?: Partial<AddPlayerFormType>;
  onSubmit: (data: AddPlayerFormType) => Promise<void>;
}

export function AddPlayerForm({ loading, defaultValues, onSubmit }: Props) {
  const { control, handleSubmit } = useForm<AddPlayerFormType>({
    resolver: zodResolver(AddPlayerFormSchema),
    defaultValues: {
      first: '',
      last: '',
      jersey: '',
      pos: 'FWD',
      ...defaultValues,
    },
  });

  return (
    <View className="gap-3 pb-4">
      <Controller
        control={control}
        name="first"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="First Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="last"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Last Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="jersey"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Jersey #" onBlur={onBlur} onChangeText={onChange} value={value} keyboardType="number-pad" />
        )}
      />
      <Controller
        control={control}
        name="pos"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Position (FWD/DEF/GTL)" onBlur={onBlur} onChangeText={onChange} value={value} autoCapitalize="characters" />
        )}
      />
      <Controller
        control={control}
        name="yearOfBirth"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Year of Birth" onBlur={onBlur} onChangeText={onChange} value={value} keyboardType="number-pad" />
        )}
      />
      <Controller
        control={control}
        name="guardianName"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Guardian Name" onBlur={onBlur} onChangeText={onChange} value={value} />
        )}
      />
      <Controller
        control={control}
        name="guardianEmail"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Guardian Email" onBlur={onBlur} onChangeText={onChange} value={value} autoCapitalize="none" keyboardType="email-address" />
        )}
      />
      <Controller
        control={control}
        name="guardianPhone"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Guardian Phone" onBlur={onBlur} onChangeText={onChange} value={value} keyboardType="phone-pad" />
        )}
      />
      <Controller
        control={control}
        name="medicalInfo"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Medical Info" onBlur={onBlur} onChangeText={onChange} value={value} multiline numberOfLines={2} />
        )}
      />
      <Controller
        control={control}
        name="friend1Name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Friend 1" onBlur={onBlur} onChangeText={onChange} value={value} />
        )}
      />
      <Controller
        control={control}
        name="friend2Name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Friend 2" onBlur={onBlur} onChangeText={onChange} value={value} />
        )}
      />
      <Button label="Save Player" onPress={handleSubmit(onSubmit)} loading={loading} />
    </View>
  );
}
