import { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { formatCad } from '@/data/plans';
import { useReferralSummaryQuery } from '@/features/queries';
import type { ReferralLedgerEntry } from '@/data/types';

const REFERRAL_BONUS_CENTS = 100;

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function LedgerRow({ entry }: { entry: ReferralLedgerEntry }) {
  const colors = useThemeColors();
  const credited = entry.amountCents > 0;
  return (
    <View
      className="flex-row justify-between items-center py-2 border-t"
      style={{ borderColor: colors.border }}
    >
      <View className="flex-1 pr-3">
        <Text style={{ color: colors.ink }}>{entry.note ?? (credited ? 'Credit' : 'Redeemed')}</Text>
        <Text className="text-xs" style={{ color: colors.inkFaint }}>
          {formatEntryDate(entry.created_at)}
        </Text>
      </View>
      <Text
        className="font-display font-bold"
        style={{ color: credited ? colors.success : colors.inkMuted }}
      >
        {credited ? '+' : '−'}
        {formatCad(Math.abs(entry.amountCents))}
      </Text>
    </View>
  );
}

export default function LoyaltyScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const summaryQuery = useReferralSummaryQuery();
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  if (summaryQuery.isLoading) return <LoadingState message="Loading your loyalty program..." />;
  if (summaryQuery.isError) {
    return (
      <ErrorState
        message={(summaryQuery.error as Error)?.message ?? 'Could not load your loyalty program.'}
        onRetry={() => summaryQuery.refetch()}
      />
    );
  }

  const summary = summaryQuery.data;
  const code = summary?.code ?? null;
  const balanceCents = summary?.balanceCents ?? 0;
  const earnedCents = summary?.earnedLastYearCents ?? 0;
  const capCents = summary?.annualCapCents ?? 6000;
  const remainingCents = Math.max(0, capCents - earnedCents);
  const pending = Math.max(0, (summary?.referredCount ?? 0) - (summary?.convertedCount ?? 0));

  const shareCode = async () => {
    if (!code) return;
    try {
      // The deep link only auto-fills the signup field if TryoutHQ is already
      // installed (aastryout:// is a bare custom scheme, not a universal/app
      // link) — the plain code is included too so it still works as a manual
      // fallback for someone installing fresh from the app store.
      const deepLink = `aastryout://signup?ref=${encodeURIComponent(code)}`;
      await Share.share({
        message:
          `Join me on TryoutHQ — tap to sign up with my referral code applied: ${deepLink}\n\n` +
          `Or enter this code by hand when you sign up: ${code}\n\n` +
          `Once you subscribe, I get ${formatCad(REFERRAL_BONUS_CENTS)} of account credit — ` +
          `and you get the same evaluation and team-building tools I use.`,
      });
    } catch (e: any) {
      Alert.alert('Share Error', e?.message ?? 'Could not open the share sheet.');
    }
  };

  return (
    <Screen scroll>
      <Header title="Loyalty Program" subtitle="Refer coaches, earn credit" showBack />

      {/* Code + balance */}
      <Card accent className="mt-4 mb-4 gap-3">
        <Text className="text-xs uppercase" style={{ color: colors.inkFaint }}>
          Your referral code
        </Text>
        {code ? (
          <Pressable onPress={shareCode}>
            <Text
              className="text-3xl font-display font-bold tracking-widest"
              style={{ color: colors.primary }}
            >
              {code}
            </Text>
            <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
              Tap to share with friends, family, and colleagues.
            </Text>
          </Pressable>
        ) : (
          <Text style={{ color: colors.inkMuted }}>
            Your code couldn't be set up just now. Try again in a moment.
          </Text>
        )}
        {code ? (
          <Button label="Share My Code" onPress={shareCode} />
        ) : (
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => summaryQuery.refetch()}
            loading={summaryQuery.isFetching}
          />
        )}
      </Card>

      <Card className="mb-4 gap-2">
        <View className="flex-row justify-between items-start">
          <View>
            <Text className="text-xs uppercase" style={{ color: colors.inkFaint }}>
              Available credit
            </Text>
            <Text className="text-3xl font-display font-bold" style={{ color: colors.ink }}>
              {formatCad(balanceCents)}
            </Text>
          </View>
          {balanceCents > 0 ? <Badge label="Ready to redeem" variant="success" /> : null}
        </View>
        <Text className="text-xs" style={{ color: colors.inkMuted }}>
          {formatCad(earnedCents)} of {formatCad(capCents)} earned in the last 12 months
          {remainingCents > 0
            ? ` · ${formatCad(remainingCents)} still available to earn this year.`
            : ' · you have reached this year’s maximum.'}
        </Text>
        {balanceCents > 0 ? (
          <Button
            label="Redeem on a Subscription"
            className="mt-1"
            onPress={() => navigation.navigate('Upgrade')}
          />
        ) : null}
      </Card>

      {/* Referral counts */}
      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Your Referrals
        </Text>
        <View className="flex-row justify-between">
          <Text style={{ color: colors.inkMuted }}>Signed up with your code</Text>
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            {summary?.referredCount ?? 0}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text style={{ color: colors.inkMuted }}>Subscribed and paid out</Text>
          <Text className="font-display font-bold" style={{ color: colors.success }}>
            {summary?.convertedCount ?? 0}
          </Text>
        </View>
        {pending > 0 ? (
          <Text className="text-xs" style={{ color: colors.inkFaint }}>
            {pending} {pending === 1 ? 'person has' : 'people have'} signed up but not subscribed
            yet — credit lands when they do.
          </Text>
        ) : null}
      </Card>

      {/* Explainer — the "how to / benefits" button from the request. */}
      <Card className="mb-4 gap-2">
        <Button
          label={showHowItWorks ? 'Hide How It Works' : 'How the Loyalty Program Works'}
          variant="secondary"
          onPress={() => setShowHowItWorks((v) => !v)}
        />
        {showHowItWorks ? (
          <View className="gap-3 mt-2">
            <View className="gap-1">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                1. Share your code
              </Text>
              <Text style={{ color: colors.inkMuted }}>
                Every account gets its own 9-character code. Send it to friends, family, or
                colleagues who coach.
              </Text>
            </View>
            <View className="gap-1">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                2. They enter it when they subscribe
              </Text>
              <Text style={{ color: colors.inkMuted }}>
                They add your code on the Upgrade Plan screen before their first paid subscription.
                It can only be applied once, and not after they have already subscribed.
              </Text>
            </View>
            <View className="gap-1">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                3. You earn {formatCad(REFERRAL_BONUS_CENTS)} per subscriber
              </Text>
              <Text style={{ color: colors.inkMuted }}>
                Credit lands automatically once their payment goes through — up to{' '}
                {formatCad(capCents)} per year. Nothing is earned for a signup that never
                subscribes.
              </Text>
            </View>
            <View className="gap-1">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                4. Spend it on your own plan
              </Text>
              <Text style={{ color: colors.inkMuted }}>
                Your balance can be applied to any subscription payment from the Upgrade Plan
                screen. Whatever you don't use stays on your account for next time.
              </Text>
            </View>
          </View>
        ) : null}
      </Card>

      {/* Ledger */}
      <Card className="mb-4 gap-1">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Account Ledger
        </Text>
        {summary?.entries?.length ? (
          summary.entries.map((entry) => <LedgerRow key={entry.id} entry={entry} />)
        ) : (
          <Text className="text-sm py-2" style={{ color: colors.inkMuted }}>
            No activity yet. Your first referral credit will show up here.
          </Text>
        )}
      </Card>

      {summary?.redeemedByCode ? (
        <Text className="text-xs text-center mb-4" style={{ color: colors.inkFaint }}>
          You joined with referral code {summary.redeemedByCode}.
        </Text>
      ) : null}
    </Screen>
  );
}
