import { useState, useMemo } from 'react';
import { View, Text, Pressable, Image, Alert, ScrollView } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AddPlayerFormSchema, type AddPlayerForm as AddPlayerFormType, type Athlete, type Sport } from '@/data/types';
import { Button, Chip, Input, Modal, Avatar, YearField, PhoneField } from '@/components/ui';
import { useAthletesQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';
import { launchImageLibrary } from 'react-native-image-picker';
import { POSITION_OPTIONS_BY_SPORT } from '@/data/positions';

interface Props {
  loading?: boolean;
  defaultValues?: Partial<AddPlayerFormType>;
  /** Drives the position picker's options — Hockey positions for a Hockey evaluation, and so on. */
  sport?: Sport;
  onSubmit: (data: AddPlayerFormType) => Promise<void>;
  /**
   * Defaults to "Save Player". The team roster passes its own, because saving
   * there also sends the portal invite and the button should say so.
   */
  submitLabel?: string;
}

export function AddPlayerForm({ loading, defaultValues, sport, onSubmit, submitLabel }: Props) {
  const colors = useThemeColors();
  const athletesQuery = useAthletesQuery();
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(defaultValues?.avatarUrl || null);

  const positionOptions = (sport && POSITION_OPTIONS_BY_SPORT[sport]) || [];
  // Free-text once the sport has no reference list (e.g. "Other"), or the coach
  // picked "Other / custom" explicitly — otherwise a chip list of the sport's
  // own positions beats typing a code from memory.
  const [positionIsCustom, setPositionIsCustom] = useState(
    positionOptions.length === 0 ||
      !!(defaultValues?.pos && !positionOptions.some((o) => o.code === defaultValues.pos)),
  );

  const { control, handleSubmit, setValue, watch } = useForm<AddPlayerFormType>({
    resolver: zodResolver(AddPlayerFormSchema),
    defaultValues: {
      athleteId: defaultValues?.athleteId || '',
      first: defaultValues?.first || '',
      last: defaultValues?.last || '',
      jersey: defaultValues?.jersey || '',
      // 'FWD' as a bare default only makes sense for the old free-text field —
      // once a sport has its own position list, defaulting into a code that
      // isn't actually on it would silently submit a mismatched position for
      // anyone who never touches the picker.
      pos: defaultValues?.pos || (positionOptions.length > 0 ? '' : 'FWD'),
      shoots: defaultValues?.shoots || '',
      yearOfBirth: defaultValues?.yearOfBirth || '',
      positionTryingOutFor: defaultValues?.positionTryingOutFor || '',
      playerEmail: defaultValues?.playerEmail || '',
      guardianName: defaultValues?.guardianName || '',
      guardianEmail: defaultValues?.guardianEmail || '',
      guardianPhone: defaultValues?.guardianPhone || '',
      currentTeam: defaultValues?.currentTeam || '',
      currentLevel: defaultValues?.currentLevel || '',
      aboutChild: defaultValues?.aboutChild || '',
      medicalInfo: defaultValues?.medicalInfo || '',
      friend1Name: defaultValues?.friend1Name || '',
      friend2Name: defaultValues?.friend2Name || '',
      avatarUrl: defaultValues?.avatarUrl || '',
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
    setValue('playerEmail', a.playerEmail || '');
    setValue('guardianName', a.guardianName || '');
    setValue('guardianEmail', a.guardianEmail || '');
    setValue('guardianPhone', a.guardianPhone || '');
    setValue('medicalInfo', a.medicalInfo || '');
    setValue('aboutChild', a.aboutChild || '');
    const pos = a.currentPosition || (positionOptions.length > 0 ? '' : 'FWD');
    setPositionIsCustom(
      positionOptions.length === 0 || (!!pos && !positionOptions.some((o) => o.code === pos)),
    );
    setValue('pos', pos);
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
          <Input label="Jersey #" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} keyboardType="number-pad" />
        )}
      />
      <Controller
        control={control}
        name="pos"
        render={({ field: { onChange, onBlur, value }, fieldState: { error } }) =>
          positionOptions.length > 0 && !positionIsCustom ? (
            <View className="gap-1">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Position
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {positionOptions.map((o) => (
                  <Chip key={o.code} label={o.label} active={value === o.code} onPress={() => onChange(o.code)} />
                ))}
                <Chip
                  label="Other / custom…"
                  onPress={() => {
                    setPositionIsCustom(true);
                    onChange('');
                  }}
                />
              </ScrollView>
              {error?.message ? (
                <Text className="text-sm" style={{ color: colors.danger }}>
                  {error.message}
                </Text>
              ) : null}
            </View>
          ) : (
            <Input
              label={positionOptions.length > 0 ? 'Position (custom)' : 'Position (FWD/DEF/GTL)'}
              onBlur={onBlur}
              onChangeText={(t) => onChange(t.toUpperCase())}
              value={value}
              error={error?.message}
              autoCapitalize="characters"
              rightAccessory={
                positionOptions.length > 0 ? (
                  <Button
                    label="Use list"
                    variant="ghost"
                    size="sm"
                    className="min-h-[32px] px-2 py-1"
                    onPress={() => setPositionIsCustom(false)}
                  />
                ) : undefined
              }
            />
          )
        }
      />
      <Controller
        control={control}
        name="yearOfBirth"
        render={({ field: { onChange, value }, fieldState: { error } }) => (
          <YearField label="Year of Birth" value={value} onChange={onChange} error={error?.message} />
        )}
      />
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
          <Input label="Guardian Email *" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} autoCapitalize="none" keyboardType="email-address" />
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
      <Button
        label={submitLabel ?? 'Save Player'}
        onPress={handleSubmit(onSubmit, (errors) => {
          const emailError = errors.guardianEmail ?? errors.playerEmail;
          if (emailError) {
            Alert.alert('Invalid Email', emailError.message || 'Please enter a valid email address');
          } else {
            Alert.alert('Validation Error', 'Please check the highlighted fields before saving.');
          }
        })}
        loading={loading}
      />
    </View>
  );
}
