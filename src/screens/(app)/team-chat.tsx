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
    // KeyboardAvoidingView is off because TeamChat handles the keyboard itself,
    // padding its composer by the measured keyboard height. Letting both run
    // moved the composer twice; letting only KeyboardAvoidingView run left it
    // short by about the navigation bar under `adjustNothing`, so the keyboard
    // covered the bottom of the input. See the keyboardHeight effect there.
    <Screen keyboardAvoiding={false}>
      <Header title={title || 'Team Chat'} subtitle={subtitle} showBack />
      <TeamChat seasonId={seasonId} noSeasonMessage={noSeasonMessage} />
    </Screen>
  );
}
