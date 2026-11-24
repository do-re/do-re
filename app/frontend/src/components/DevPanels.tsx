/**
 * What developer mode shows: a song's 7 Audio Features on Home, and the user's Taste Vector on
 * Profile. Values are the stored 0-to-1 numbers. On the demo backend they're labelled as demo data,
 * because the songs and their features are invented.
 */
import { useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { FEATURE_NAMES, type Song } from '../api/types';
import './devPanels.css';

/**
 * Requires: values has one number in [0, 1] per entry of FEATURE_NAMES.
 * Effects: renders one labelled bar per feature.
 */
function FeatureBars({ values }: { values: readonly number[] }) {
  return (
    <ul className="feature-bars">
      {FEATURE_NAMES.map((name, index) => (
        <li key={name} className="feature-bars__row">
          <span className="feature-bars__name">{name}</span>
          <span
            className="feature-bars__track"
            role="meter"
            aria-label={name}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={values[index]}
            aria-valuetext={values[index].toFixed(2)}
          >
            <span className="feature-bars__fill" style={{ width: `${values[index] * 100}%` }} />
          </span>
          <span className="feature-bars__value">{values[index].toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

function DemoTag() {
  return <span className="dev-panel__tag">Demo data</span>;
}

/**
 * Requires: rendered inside ApiProvider.
 * Effects: shows the song's ID, length, Spotify URI and Audio Features.
 */
export function SongStatsPanel({ song }: { song: Song }) {
  const isDemo = useApi().demo !== undefined;
  return (
    <section className="dev-panel dev-panel--on-color" aria-label="Song stats">
      <h2 className="dev-panel__title">
        Song stats {isDemo && <DemoTag />}
      </h2>
      <FeatureBars values={song.features} />
      <p className="dev-panel__meta">
        {song.id} · {song.durationSeconds} s · {song.spotifyUri}
      </p>
    </section>
  );
}

type TasteState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; taste: readonly number[] };

/**
 * Requires: rendered inside ApiProvider, for a logged-in userId.
 * Effects: loads and shows the user's Taste Vector.
 */
export function TasteVectorPanel({ userId }: { userId: string }) {
  const api = useApi();
  const [state, setState] = useState<TasteState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.songs.getTasteVector(userId).then(
      (taste) => {
        if (!cancelled) setState({ kind: 'ready', taste });
      },
      () => {
        if (!cancelled) setState({ kind: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, userId, attempt]);

  return (
    <section className="dev-panel" aria-label="Your taste vector">
      <h2 className="dev-panel__title">
        Your taste vector {api.demo !== undefined && <DemoTag />}
      </h2>
      {state.kind === 'loading' && <p className="dev-panel__meta">Loading your taste vector…</p>}
      {state.kind === 'failed' && (
        <div role="alert">
          <p className="dev-panel__meta">Couldn't load your taste vector. Check your connection and try again.</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setState({ kind: 'loading' });
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {state.kind === 'ready' && (
        <>
          <FeatureBars values={state.taste} />
          <p className="dev-panel__meta">
            {state.taste.every((value) => value === 0.5)
              ? 'Every value starts at 0.50. Swipe on some songs to move it.'
              : 'Likes pull these values toward a song. Skips push them away.'}
          </p>
        </>
      )}
    </section>
  );
}
