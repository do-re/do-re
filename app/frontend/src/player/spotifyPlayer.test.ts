import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlayerFactory } from './PlayerContext';
import {
  createSpotifyPlayer,
  loadSpotifyIframeApi,
  resetSpotifyIframeApiForTests,
  SPOTIFY_IFRAME_API_URL,
  type SpotifyEmbedController,
  type SpotifyIframeApi,
  type SpotifyPlaybackData,
} from './spotifyPlayer';
import type { PlaybackState } from './types';

const URI_A = 'spotify:track:AAA';
const URI_B = 'spotify:track:BBB';

/** Stands in for Spotify's EmbedController. */
class FakeController implements SpotifyEmbedController {
  calls: string[] = [];
  private listeners = new Map<string, (event: { data: SpotifyPlaybackData }) => void>();
  loadUri(uri: string) { this.calls.push(`loadUri ${uri}`); }
  play() { this.calls.push('play'); }
  togglePlay() { this.calls.push('togglePlay'); }
  seek(seconds: number) { this.calls.push(`seek ${seconds}`); }
  destroy() { this.calls.push('destroy'); }
  addListener(event: string, callback: (event: { data: SpotifyPlaybackData }) => void) {
    this.listeners.set(event, callback);
  }
  fire(event: string, data?: SpotifyPlaybackData) {
    this.listeners.get(event)!({ data: data! });
  }
}

/** Stands in for IFrameAPI; createController waits until `finish()` is called. */
function fakeApi() {
  const controller = new FakeController();
  const created: { element: HTMLElement; uri: string }[] = [];
  let finish!: () => void;
  const api: SpotifyIframeApi = {
    createController(element, options, callback) {
      created.push({ element, uri: options.uri });
      finish = () => callback(controller);
    },
  };
  return { api, controller, created, finish: () => finish() };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const fake = fakeApi();
  const loadApi = vi.fn(() => Promise.resolve(fake.api));
  const player = createSpotifyPlayer(container, loadApi);
  const updates: PlaybackState[] = [];
  player.subscribe((s) => updates.push(s));
  return { container, player, loadApi, updates, ...fake };
}

afterEach(() => {
  resetSpotifyIframeApiForTests();
  document.body.replaceChildren();
});

describe('createSpotifyPlayer', () => {
  it('R_HOME_13 creates the embed on first load and plays when it is ready', async () => {
    const { container, player, created, controller, finish } = setup();
    player.load(URI_A);
    await flush();
    expect(created).toHaveLength(1);
    expect(created[0].uri).toBe(URI_A);
    expect(container.contains(created[0].element)).toBe(true);
    finish();
    controller.fire('ready');
    expect(controller.calls).toEqual(['play']);
  });

  it('R_HOME_05 converts playback updates from milliseconds to seconds', async () => {
    const { player, controller, finish, updates } = setup();
    player.load(URI_A);
    await flush();
    finish();
    controller.fire('playback_update', { isPaused: false, duration: 30000, position: 12500 });
    controller.fire('playback_update', { isPaused: true, duration: -5, position: -1 });
    expect(updates).toEqual([
      { positionSeconds: 12.5, durationSeconds: 30, isPaused: false },
      { positionSeconds: 0, durationSeconds: 0, isPaused: true },
    ]);
  });

  it('R_HOME_07 R_HOME_08 later loads, toggles and seeks go to the controller', async () => {
    const { player, controller, finish, loadApi } = setup();
    player.togglePlay(); // before the embed exists: ignored
    player.seek(3);
    player.load(URI_A);
    await flush();
    finish();
    player.load(URI_B);
    player.togglePlay();
    player.seek(10);
    expect(controller.calls).toEqual([`loadUri ${URI_B}`, 'play', 'togglePlay', 'seek 10']);
    expect(loadApi).toHaveBeenCalledTimes(1);
  });

  it('a load while the embed is still being created plays the latest song once ready', async () => {
    const { player, controller, created, finish } = setup();
    player.load(URI_A);
    player.load(URI_B);
    await flush();
    expect(created).toHaveLength(1);
    finish();
    expect(controller.calls).toEqual([`loadUri ${URI_B}`, 'play']);
  });

  it('unsubscribed listeners get no more updates', async () => {
    const { player, controller, finish } = setup();
    const listener = vi.fn();
    const unsubscribe = player.subscribe(listener);
    player.load(URI_A);
    await flush();
    finish();
    unsubscribe();
    controller.fire('playback_update', { isPaused: false, duration: 1000, position: 0 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('destroy removes the embed, drops listeners and ignores later calls', async () => {
    const { container, player, controller, finish, updates, created } = setup();
    player.load(URI_A);
    await flush();
    finish();
    player.destroy();
    expect(controller.calls).toContain('destroy');
    expect(container.childElementCount).toBe(0);
    controller.fire('playback_update', { isPaused: false, duration: 1000, position: 0 });
    expect(updates).toEqual([]);
    player.load(URI_B);
    await flush();
    expect(created).toHaveLength(1);
  });

  it('destroy before the API loads means no embed is created', async () => {
    const { player, created } = setup();
    player.load(URI_A);
    player.destroy();
    await flush();
    expect(created).toEqual([]);
  });

  it('destroy while the embed is being created destroys it as soon as it arrives', async () => {
    const { player, controller, finish } = setup();
    player.load(URI_A);
    await flush();
    player.destroy();
    finish();
    expect(controller.calls).toEqual(['destroy']);
  });

  it('if the Spotify script fails, the next load tries again', async () => {
    const container = document.createElement('div');
    const fake = fakeApi();
    const loadApi = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(fake.api);
    const player = createSpotifyPlayer(container, loadApi);
    player.load(URI_A);
    await flush();
    expect(container.childElementCount).toBe(0);
    player.load(URI_B);
    await flush();
    expect(loadApi).toHaveBeenCalledTimes(2);
    expect(fake.created[0].uri).toBe(URI_B);
  });

  it('if the Spotify script fails, shows the play button, and pressing it tries again', async () => {
    const container = document.createElement('div');
    const fake = fakeApi();
    const loadApi = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(fake.api);
    const player = createSpotifyPlayer(container, loadApi);
    const updates: PlaybackState[] = [];
    player.subscribe((s) => updates.push(s));
    player.load(URI_A);
    await flush();
    expect(updates).toEqual([{ positionSeconds: 0, durationSeconds: 0, isPaused: true }]);
    player.togglePlay();
    await flush();
    expect(loadApi).toHaveBeenCalledTimes(2);
    expect(fake.created[0].uri).toBe(URI_A);
  });

  it('pressing play while the embed is still being created does not create a second one', async () => {
    const { player, loadApi } = setup();
    player.load(URI_A);
    player.togglePlay();
    await flush();
    expect(loadApi).toHaveBeenCalledTimes(1);
  });

  it('pressing play after destroy does nothing', async () => {
    const container = document.createElement('div');
    const loadApi = vi.fn().mockRejectedValue(new Error('blocked'));
    const player = createSpotifyPlayer(container, loadApi);
    player.load(URI_A);
    await flush();
    player.destroy();
    player.togglePlay();
    await flush();
    expect(loadApi).toHaveBeenCalledTimes(1);
  });
});

describe('loadSpotifyIframeApi', () => {
  it('adds the script once and resolves when Spotify calls back', async () => {
    const first = loadSpotifyIframeApi();
    expect(loadSpotifyIframeApi()).toBe(first);
    const scripts = document.querySelectorAll(`script[src="${SPOTIFY_IFRAME_API_URL}"]`);
    expect(scripts).toHaveLength(1);
    const api = fakeApi().api;
    window.onSpotifyIframeApiReady!(api);
    await expect(first).resolves.toBe(api);
  });

  it('rejects if the script fails, and a later call adds a fresh script', async () => {
    const first = loadSpotifyIframeApi();
    const script = document.querySelector<HTMLScriptElement>(`script[src="${SPOTIFY_IFRAME_API_URL}"]`)!;
    script.onerror!(new Event('error'));
    await expect(first).rejects.toThrow('Could not load the Spotify player');
    expect(document.querySelector('script')).toBeNull();
    const second = loadSpotifyIframeApi();
    expect(second).not.toBe(first);
    expect(document.querySelectorAll('script')).toHaveLength(1);
  });
});

describe('usePlayerFactory', () => {
  it('defaults to the Spotify player when no provider is present', () => {
    function Probe() {
      return createElement('p', null, usePlayerFactory() === createSpotifyPlayer ? 'spotify' : 'other');
    }
    render(createElement(Probe));
    expect(screen.getByText('spotify')).toBeInTheDocument();
  });
});
