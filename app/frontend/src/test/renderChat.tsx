/**
 * Test helpers for the chat screens: renders the whole app with a mock the test already set up,
 * and advances fake timers inside act().
 */
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../App';
import { createMockApi, type MockOptions } from '../api/mock';
import { FakePlayer } from './fakePlayer';

export type MockApi = ReturnType<typeof createMockApi>;

/** @returns a mock with demo's seeded chats and no bots, so nothing arrives unless a test sends it */
export function seededApi(options: MockOptions = {}): MockApi {
  return createMockApi({ withBots: false, withSeedChats: true, songOrder: 'library', ...options });
}

/** Effects: renders the app at path, logged in as userId. */
export function renderChatApp(api: MockApi, path: string, userId: string | null = 'u-demo') {
  const player = new FakePlayer();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App api={api} initialUserId={userId} createPlayer={player.factory} />
    </MemoryRouter>,
  );
}

/** Requires: fake timers are on. Effects: advances them and lets React finish updating. */
export async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
