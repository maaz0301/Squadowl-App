import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen, Button } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />
      <Screen className="justify-center items-center gap-4">
        <Text className="text-xl font-display font-bold">This screen doesn't exist.</Text>
        <Link href="/" asChild>
          <Button label="Go Home" />
        </Link>
      </Screen>
    </>
  );
}
