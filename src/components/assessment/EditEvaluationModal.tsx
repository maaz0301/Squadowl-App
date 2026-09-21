import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { MapLocationHint } from '@/components/MapLink';
import { Button, DateField, Input, Modal, TimeField } from '@/components/ui';
import { useUpdateTryoutMutation } from '@/features/queries';
import { END_BEFORE_START_MESSAGE, isEndAfterStart } from '@/data/timeRange';
import type { TryoutSummary } from '@/data/types';

/**
 * The fields of an evaluation a coach edits after creating it — the same set
 * the Evaluation Settings "Edit Details" dialog offers, reachable straight from
 * the evaluation's tile instead of by opening the evaluation and finding it in
 * Settings.
 *
 * Fed from the list summary rather than the full evaluation, so opening it
 * costs no read at all.
 */
export function EditEvaluationModal({
  tryout,
  onClose,
}: {
  /** The evaluation being edited; null keeps the dialog closed. */
  tryout: Pick<TryoutSummary, 'id' | 'name' | 'tryoutDate' | 'startTime' | 'endTime' | 'rink'> | null;
  onClose: () => void;
}) {
  const updateTryout = useUpdateTryoutMutation();
  const [name, setName] = useState('');
  const [tryoutDate, setTryoutDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [rink, setRink] = useState('');
  const [endTimeError, setEndTimeError] = useState('');

  // Reseeded whenever a different evaluation is opened, so nothing typed into
  // one tile's dialog can leak into the next.
  const id = tryout?.id;
  useEffect(() => {
    if (!tryout) return;
    setName(tryout.name);
    setTryoutDate(tryout.tryoutDate ?? '');
    setStartTime(tryout.startTime ?? '');
    setEndTime(tryout.endTime ?? '');
    setRink(tryout.rink ?? '');
    setEndTimeError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    if (!tryout) return;
    if (!isEndAfterStart(startTime, endTime)) {
      setEndTimeError(END_BEFORE_START_MESSAGE);
      return;
    }
    setEndTimeError('');
    try {
      // Same mapping as Evaluation Settings: a blank field is left as it was
      // rather than cleared.
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          name: name.trim() || tryout.name,
          tryoutDate: tryoutDate.trim() || undefined,
          startTime: startTime.trim() || undefined,
          endTime: endTime.trim() || undefined,
          rink: rink.trim() || undefined,
        },
      });
      onClose();
    } catch (e: any) {
      Alert.alert('Could Not Save', e?.message || 'The changes could not be saved. Please try again.');
    }
  };

  return (
    <Modal visible={tryout !== null} title="Edit Evaluation" onClose={onClose}>
      <View className="gap-3">
        <Input label="Name" value={name} onChangeText={setName} />
        <DateField label="Date" value={tryoutDate} onChange={setTryoutDate} placeholder="Select a date" />
        <TimeField
          label="Start Time"
          value={startTime}
          onChange={(v) => {
            setStartTime(v);
            setEndTimeError('');
          }}
          placeholder="Select a time"
        />
        <TimeField
          label="End Time"
          value={endTime}
          onChange={(v) => {
            setEndTime(v);
            setEndTimeError('');
          }}
          placeholder="Select a time"
          error={endTimeError || undefined}
        />
        <View>
          <Input
            label="Location"
            value={rink}
            onChangeText={setRink}
            placeholder="Field A, 55 Bloor St W, Toronto"
          />
          <MapLocationHint location={rink} />
        </View>
        <Button label="Save" onPress={save} loading={updateTryout.isPending} />
      </View>
    </Modal>
  );
}
