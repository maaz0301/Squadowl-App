import { useRoute } from '@react-navigation/native';

import { Header, Screen } from '@/components/ui';
import { TeamChat } from '@/components/TeamChat';

/**
 * Full-screen team chat, pushed from both the coach's Team screen and a
 * guardian's portal rather than embedded inline as a tab. A chat composer
 * needs the keyboard to have the whole screen to work with — sharing that
 * space with a profile header and a tab bar (the previous embedded layout)
 * left too little room above the keyboard on both platforms.
 */
export default function TeamChatScreen() {
  const route = useRoute<any>();
  const { seasonId, title, subtitle, noSeasonMessage } = route.params || {};

  return (
    // Screen's default iOS keyboardOffset (88) assumes a native bottom tab bar
    // sits below it and compensates for that reserved space — this screen has
    // no tab bar, so that default leaves a gap between the composer and the
    // keyboard. 0 is correct here; Android already defaults to 0 regardless.
    <Screen keyboardOffset={0}>
      <Header title={title || 'Team Chat'} subtitle={subtitle} showBack />
      <TeamChat seasonId={seasonId} noSeasonMessage={noSeasonMessage} />
    </Screen>
  );
}
