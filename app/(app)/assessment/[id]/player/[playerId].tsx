import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Modal,
  Screen,
} from '@/components/ui';
import {
  useTryoutQuery,
  useUpdatePlayerMutation,
  useDeletePlayerMutation,
  useAiPlayerSummaryMutation,
} from '@/features/queries';
import { playerDisplayName } from '@/data/rubrics';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { PlanGate } from '@/components/PlanGate';

export default function PlayerHubScreen() {
  const { id, playerId } = useLocalSearchParams<{ id: string; playerId: string }>();
  const colors = useThemeColors();
  const router = useRouter();
  const tryoutQuery = useTryoutQuery(id);
  const updatePlayer = useUpdatePlayerMutation(id!);
  const deletePlayer = useDeletePlayerMutation(id!);
  const aiSummary = useAiPlayerSummaryMutation(id!);
  const [showEdit, setShowEdit] = useState(false);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }

  const player = tryoutQuery.data.roster.find((p) => p.id === playerId);
  if (!player) return <EmptyState title="Player not found" />;

  const evals = tryoutQuery.data.evals
    .filter((e) => e.playerId === playerId)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Screen scroll>
      <Header title={playerDisplayName(player)} showBack />
      <View className="items-center py-4 gap-2">
        <Avatar first={player.first} last={player.last} pos={player.pos} size={72} />
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          #{player.jersey ?? '—'} · {player.pos ?? '—'} · ID {player.athleteId ?? '—'}
        </Text>
        {player.registrationSource === 'qr' ? <Badge label="QR Registered" variant="info" /> : null}
      </View>

      <View className="flex-row gap-2 mb-4">
        <Button
          label="Score Player"
          className="flex-1"
          onPress={() => router.push(`/(app)/assessment/${id}/score/${playerId}`)}
        />
        <Button label="Edit" variant="secondary" className="flex-1" onPress={() => setShowEdit(true)} />
      </View>

      {player.guardianName ? (
        <Card className="mb-4 gap-1">
          <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
            Guardian
          </Text>
          <Text style={{ color: colors.ink }}>{player.guardianName}</Text>
          {player.guardianEmail ? (
            <Text style={{ color: colors.inkMuted }}>{player.guardianEmail}</Text>
          ) : null}
        </Card>
      ) : null}

      <PlanGate feature="aiSummaries" title="AI Player Summary (Club+)">
        <Card accent className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            AI Development Summary
          </Text>
          {tryoutQuery.data.aiAssessments?.[playerId!] ? (
            <>
              <Text style={{ color: colors.inkMuted }}>
                {tryoutQuery.data.aiAssessments[playerId!].summary}
              </Text>
              <Text className="text-sm" style={{ color: colors.primary }}>
                Role fit: {tryoutQuery.data.aiAssessments[playerId!].role_fit}
              </Text>
            </>
          ) : (
            <Button
              label="Generate AI Summary"
              size="sm"
              onPress={() => aiSummary.mutate(playerId!)}
              loading={aiSummary.isPending}
            />
          )}
          {aiSummary.data ? (
            <>
              <Text style={{ color: colors.inkMuted }}>{aiSummary.data.summary}</Text>
              {aiSummary.data.key_strengths.map((s) => (
                <Text key={s} className="text-sm" style={{ color: colors.success }}>+ {s}</Text>
              ))}
            </>
          ) : null}
        </Card>
      </PlanGate>

      <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
        Evaluations ({evals.length})
      </Text>
      {evals.length === 0 ? (
        <EmptyState title="No evaluations yet" message="Tap Score Player to add the first evaluation." />
      ) : (
        evals.map((ev) => (
          <Card key={ev.id} className="mb-2 gap-1">
            <View className="flex-row justify-between">
              <Text className="font-bold" style={{ color: colors.ink }}>
                {ev.session} · {ev.date}
              </Text>
              {ev.recommendation ? <Badge label={ev.recommendation} variant="brand" /> : null}
            </View>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {ev.evaluator}
            </Text>
            {ev.strengths ? (
              <Text className="text-sm mt-1" style={{ color: colors.ink }}>
                + {ev.strengths}
              </Text>
            ) : null}
            {ev.improve ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                → {ev.improve}
              </Text>
            ) : null}
            <Button
              label="Edit Score"
              size="sm"
              variant="ghost"
              onPress={() =>
                router.push(`/(app)/assessment/${id}/score/${playerId}?evalId=${ev.id}`)
              }
            />
          </Card>
        ))
      )}

      <Button
        label="Delete Player"
        variant="danger"
        className="mt-6"
        loading={deletePlayer.isPending}
        onPress={async () => {
          await deletePlayer.mutateAsync(playerId!);
          router.back();
        }}
      />

      <Modal visible={showEdit} title="Edit Player" onClose={() => setShowEdit(false)}>
        <AddPlayerForm
          defaultValues={player}
          loading={updatePlayer.isPending}
          onSubmit={async (data) => {
            await updatePlayer.mutateAsync({ playerId: playerId!, updates: data });
            setShowEdit(false);
          }}
        />
      </Modal>
    </Screen>
  );
}
