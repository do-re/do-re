import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advance } from '../test/renderChat';
import { usePolling, type PollResult } from './usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at once and then after each interval', async () => {
    const poll = vi.fn(async (): Promise<PollResult> => 'continue');
    renderHook(() => usePolling(poll, 1000));
    await advance();
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(999);
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('never overlaps: the next run waits for a slow reply', async () => {
    let finish: (r: PollResult) => void = () => {};
    const poll = vi.fn(() => new Promise<PollResult>((resolve) => (finish = resolve)));
    renderHook(() => usePolling(poll, 1000));
    await advance(5000);
    expect(poll).toHaveBeenCalledTimes(1);
    finish('continue');
    await advance(1000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("stops when a run returns 'stop'", async () => {
    const poll = vi.fn(async (): Promise<PollResult> => 'stop');
    renderHook(() => usePolling(poll, 1000));
    await advance(5000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a run throws', async () => {
    const poll = vi.fn(async (): Promise<PollResult> => {
      throw new Error('boom');
    });
    renderHook(() => usePolling(poll, 1000));
    await advance(1000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('stops on unmount and reports itself inactive to a run in flight', async () => {
    let isActive: () => boolean = () => true;
    let finish: (r: PollResult) => void = () => {};
    const poll = vi.fn((active: () => boolean) => {
      isActive = active;
      return new Promise<PollResult>((resolve) => (finish = resolve));
    });
    const { unmount } = renderHook(() => usePolling(poll, 1000));
    await advance();
    expect(isActive()).toBe(true);
    unmount();
    expect(isActive()).toBe(false);
    finish('continue');
    await advance(5000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('uses the latest poll function', async () => {
    const first = vi.fn(async (): Promise<PollResult> => 'continue');
    const second = vi.fn(async (): Promise<PollResult> => 'continue');
    const { rerender } = renderHook(({ poll }) => usePolling(poll, 1000), { initialProps: { poll: first } });
    await advance();
    rerender({ poll: second });
    await advance(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
