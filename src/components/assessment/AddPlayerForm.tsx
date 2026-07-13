import { useState, useMemo } from 'react';
import { View, Text, Pressable, Image, Alert } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AddPlayerFormSchema, type AddPlayerForm as AddPlayerFormType, type Athlete } from '@/data/types';
import { Button, Input, Modal, Avatar, YearField, PhoneField } from '@/components/ui';
import { useAthletesQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';
import { launchImageLibrary } from 'react-native-image-picker';

interface Props {
  loading?: boolean;
  defaultValues?: Partial<AddPlayerFormType>;
  onSubmit: (data: AddPlayerFormType) => Promise<void>;
}

export function AddPlayerForm({ loading, defaultValues, onSubmit }: Props) {
  const colors = useThemeColors();
  const athletesQuery = useAthletesQuery();
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(defaultValues?.avatarUrl || null);

  const { control, handleSubmit, setValue, watch } = useForm<AddPlayerFormType>({
    resolver: zodResolver(AddPlayerFormSchema),
    defaultValues: {
      athleteId: '',
      first: '',
      last: '',
      jersey: '',
      pos: 'FWD',
      avatarUrl: '',
      ...defaultValues,
    },
  });

  const firstVal = watch('first');
  const lastVal = watch('last');

  const selectPhoto = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });
    if (!result.didCancel && result.assets && result.assets.length > 0) {
      const selected = result.assets[0];
      setPhotoUri(selected.uri || null);
      setValue('avatarUrl', selected.uri || '');
    }
  };

  const filteredAthletes = useMemo(() => {
    if (!athletesQuery.data) return [];
    const q = searchQuery.toLowerCase();
    return athletesQuery.data.filter(
      (a) => a.first.toLowerCase().includes(q) || a.last.toLowerCase().includes(q)
    );
  }, [athletesQuery.data, searchQuery]);

  const selectAthlete = (a: Athlete) => {
    setValue('athleteId', a.id);
    setValue('first', a.first);
    setValue('last', a.last);
    setValue('yearOfBirth', a.yearOfBirth || '');
    setValue('guardianName', a.guardianName || '');
    setValue('guardianEmail', a.guardianEmail || '');
    setValue('guardianPhone', a.guardianPhone || '');
    setValue('medicalInfo', a.medicalInfo || '');
    setValue('aboutChild', a.aboutChild || '');
    setValue('pos', a.currentPosition || 'FWD');
    setValue('currentTeam', a.currentTeam || '');
    setValue('currentLevel', a.currentLevel || '');
    setValue('jersey', a.jersey || '');
    setValue('avatarUrl', a.avatarUrl || '');
    setPhotoUri(a.avatarUrl || null);
    setModalVisible(false);
  };

  return (
    <View className="gap-3 pb-4">
      {athletesQuery.data && athletesQuery.data.length > 0 && (
        <View className="mb-2">
          <Button label="Search Existing Players" variant="secondary" onPress={() => setModalVisible(true)} />
        </View>
      )}
      
      <Modal visible={modalVisible} title="Select Existing Player" onClose={() => setModalVisible(false)}>
        <View className="mb-4">
          <Input 
            label="Search by name" 
            value={searchQuery} 
            onChangeText={setSearchQuery} 
            autoFocus 
          />
        </View>
        <View className="gap-2">
          {filteredAthletes.map((a) => (
            <Pressable
              key={a.id}
              className="p-3 rounded border"
              style={{ borderColor: colors.border, backgroundColor: colors.card }}
              onPress={() => selectAthlete(a)}
            >
              <Text className="font-bold" style={{ color: colors.ink }}>
                {a.first} {a.last}
              </Text>
              {a.yearOfBirth ? (
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Born: {a.yearOfBirth}
                </Text>
              ) : null}
              {(a.pastSeasonsCount ?? 0) > 0 ? (
                <Text className="text-xs mt-1" style={{ color: colors.primary }}>
                  Played in {a.pastSeasonsCount} previous season{a.pastSeasonsCount === 1 ? '' : 's'}
                </Text>
              ) : null}
            </Pressable>
          ))}
          {filteredAthletes.length === 0 && (
            <Text className="text-center italic mt-4" style={{ color: colors.inkMuted }}>
              No players found.
            </Text>
          )}
        </View>
      </Modal>

      <View className="items-center my-3 gap-2">
        <Avatar first={firstVal || 'P'} last={lastVal || 'L'} size={96} uri={photoUri || undefined} />
        <Button label={photoUri ? "Change Photo" : "Add Photo"} variant="secondary" onPress={selectPhoto} />
      </View>

      <Controller
        control={control}
        name="first"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="First Name *" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="last"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Last Name *" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="jersey"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Jersey # *" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} keyboardType="number-pad" />
        )}
      />
      <Controller
        control={control}
        name="pos"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Position (FWD/DEF/GTL) *" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} autoCapitalize="characters" />
        )}
      />
      <Controller
        control={control}
        name="yearOfBirth"
        render={({ field: { onChange, value }, fieldState: { error } }) => (
          <YearField label="Year of Birth *" value={value} onChange={onChange} error={error?.message} />
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
          <Input label="Guardian Email" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} autoCapitalize="none" keyboardType="email-address" />
        )}
      />
      <Controller
        control={control}
        name="guardianPhone"
        render={({ field: { onChange, value }, fieldState: { error } }) => (
          <PhoneField label="Guardian Phone" onChange={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="medicalInfo"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Medical Info" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} multiline numberOfLines={2} />
        )}
      />
      <Controller
        control={control}
        name="friend1Name"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Friend 1" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Controller
        control={control}
        name="friend2Name"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
          <Input label="Friend 2" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
        )}
      />
      <Button
        label="Save Player"
        onPress={handleSubmit(onSubmit, (errors) => {
          if (errors.guardianEmail) {
            Alert.alert('Invalid Email', errors.guardianEmail.message || 'Please enter a valid email address');
          } else {
            Alert.alert('Validation Error', 'Please check the highlighted fields before saving.');
          }
        })}
        loading={loading}
      />
    </View>
  );
}
