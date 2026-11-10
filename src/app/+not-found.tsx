import { router, Stack } from 'expo-router';

import { Button, EmptyState } from '@/components/ui';

/** Endereço que não existe no app. */
export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Página não encontrada' }} />
      <EmptyState
        title="Página não encontrada"
        text="Este endereço não existe no app."
        action={<Button title="Voltar ao fichário" variant="secondary" onPress={() => router.dismissTo('/')} />}
      />
    </>
  );
}
