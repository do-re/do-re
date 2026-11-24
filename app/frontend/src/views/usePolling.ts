/**
 * Runs an async function now and again after each run finishes. Waiting for the reply before
 * scheduling the next run means a slow server never gets overlapping requests.
 */
import { useEffect, useRef } from 'react';

/** Whether polling should go on after this run. */
export type PollResult = 'continue' | 'stop';

/**
 * Requires: intervalMs > 0.
 * Effects: while mounted, calls poll immediately and then intervalMs after each run ends, until a
 *          run returns 'stop'. A run that throws counts as 'continue'. Unmounting cancels the next
 *          run; poll receives isActive so a reply arriving after that can be ignored.
 * @param poll the work to repeat; the latest version is used on each run
 * @param intervalMs the pause between runs
 */
export function usePolling(poll: (isActive: () => boolean) => Promise<PollResult>, intervalMs: number): void {
  const latestPoll = useRef(poll);

  useEffect(() => {
    latestPoll.current = poll;
  }, [poll]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isActive = () => active;

    async function run() {
      let result: PollResult = 'continue';
      try {
        result = await latestPoll.current(isActive);
      } catch {
        // Try again on the next run.
      }
      if (active && result === 'continue') timer = setTimeout(() => void run(), intervalMs);
    }

    void run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [intervalMs]);
}
