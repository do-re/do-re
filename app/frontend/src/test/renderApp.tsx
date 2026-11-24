/**
 * Test helper: renders the whole app at a URL with a fresh mock backend and a fake player.
 * The mock starts without its seeded pending match unless `mock.withPendingMatch` is true, so
 * opening /home doesn't jump to MatchView in tests that aren't about matches.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { createMockApi, type MockOptions } from '../api/mock';
import { FakePlayer } from './fakePlayer';

export interface RenderAppOptions {
  readonly path?: string;
  readonly userId?: string | null;
  readonly mock?: MockOptions;
}

export function renderApp({ path = '/', userId = null, mock = {} }: RenderAppOptions = {}) {
  const api = createMockApi({ withPendingMatch: false, ...mock });
  const player = new FakePlayer();
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <App api={api} initialUserId={userId} createPlayer={player.factory} />
    </MemoryRouter>,
  );
  return { ...result, api, player };
}
