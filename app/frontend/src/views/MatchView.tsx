/**
 * MatchView: the /match/:matchId page (architecture-stubs-v2.java MatchView; layout from the UI
 * sketch). "You matched with <username>!", both users' profile pictures joined by a music note,
 * "XX.X% match!", "Skip or play this match?" and skip (decline) / play (confirm) buttons.
 *
 * After confirming (OPEN-4, assumed): if the other user already confirmed, the chat opens;
 * otherwise the user goes back home and the chat appears in Messages once the other user
 * confirms. Declining goes back home. Both replace this page in the history, so Back doesn't
 * return to a match that was already answered.
 *
 * Satisfies: R-HOME-18 (shows the percentage), R-HOME-20, R-HOME-21, R-HOME-22, R-HOME-23.
 * Communicates with: MatchController and AccountController (via useApi()), ViewController
 * (via the router).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import { displayName } from '../api/profile';
import { Avatar } from '../components/Avatar';
import { MAX_REPORT_DETAILS, REPORT_REASONS, type Match, type ReportReason, type UserProfile } from '../api/types';
import { Modal } from '../components/Modal';
import { PATHS } from '../paths';
import { useSession } from '../session/SessionContext';
import './match.css';
import { markMatchShown } from './homeLogic';
import { formatPercent } from './matchLogic';

type Loaded = { match: Match; self: UserProfile; other: UserProfile };
type LoadState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | ({ kind: 'ready' } & Loaded);

/**
 * The /match/:matchId page.
 * Requires: rendered inside ApiProvider, SessionProvider (with a logged-in user) and a router
 *           whose route has a :matchId parameter.
 * Effects: loads the match and both profiles and shows them (stub displayMatch); if the match
 *          doesn't exist or isn't the user's, says so with a link home.
 */
export function MatchView() {
  const matchId = useParams<{ matchId: string }>().matchId!;
  // A new match ID starts a fresh page, so one match's state never shows under another's URL.
  return <MatchPage key={matchId} matchId={matchId} />;
}

function MatchPage({ matchId }: { matchId: string }) {
  const api = useApi();
  const userId = useSession().userId!;
  const navigate = useNavigate();

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  // The Report dialog (OPEN-18).
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const reportButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const match = await api.matches.getMatch(matchId, userId);
        if (match === null) {
          if (!cancelled) setLoad({ kind: 'missing' });
          return;
        }
        const [self, other] = await Promise.all([
          api.account.getProfile(userId),
          api.matches.getOtherProfile(match, userId),
        ]);
        if (cancelled) return;
        // Seen now, so HomeView won't open it again by itself (R-HOME-20).
        markMatchShown(match.matchId);
        setLoad({ kind: 'ready', match, self, other });
      } catch {
        if (!cancelled) setLoad({ kind: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, matchId, userId, attempt]);

  /**
   * Stub onConfirmPressed / onDeclinePressed.
   * Satisfies: R-HOME-21, R-HOME-22, R-HOME-23.
   * Requires: a match is displayed.
   * Effects: disables both buttons until the reply arrives, then sends the answer to
   *          MatchController. Confirm: opens the chat if one was returned, otherwise goes home
   *          with a note that the chat will appear once the other user confirms (OPEN-4).
   *          Decline: goes home. On failure, stays and says what to do.
   */
  async function answer(confirm: boolean) {
    if (load.kind !== 'ready' || answering) return;
    setAnswering(true);
    setAnswerError(null);
    try {
      if (confirm) {
        const chatId = await api.matches.confirmMatch(load.match, userId);
        if (chatId !== null) {
          navigate(PATHS.chat(chatId), { replace: true });
        } else {
          navigate(PATHS.home, {
            replace: true,
            state: {
              notice: `You said yes to ${displayName(load.other)}! Your chat will appear in Messages once they say yes too.`,
            },
          });
        }
      } else {
        await api.matches.declineMatch(load.match, userId);
        navigate(PATHS.home, { replace: true });
      }
    } catch {
      setAnswerError("Couldn't save your answer. Check your connection and try again.");
      setAnswering(false);
    }
  }

  /**
   * WEB: the Report dialog's submit (OPEN-18).
   * Requires: a match is displayed.
   * Effects: checks that a reason is chosen and the details fit; sends the report, which also
   *          declines the match; then goes home with a notice. On failure, stays in the dialog
   *          and says what to do.
   */
  async function submitReport(event: FormEvent) {
    event.preventDefault();
    if (load.kind !== 'ready' || reporting) return;
    if (reason === null) {
      setReportError('Choose a reason.');
      return;
    }
    if (details.length > MAX_REPORT_DETAILS) {
      setReportError(`Keep the details to ${MAX_REPORT_DETAILS} characters or fewer.`);
      return;
    }
    setReporting(true);
    setReportError(null);
    try {
      await api.matches.reportProfile(load.match, userId, reason, details);
      navigate(PATHS.home, {
        replace: true,
        state: { notice: `Thanks. We'll review your report about ${displayName(load.other)}, and you won't be matched again.` },
      });
    } catch {
      setReportError("Couldn't send your report. Check your connection and try again.");
      setReporting(false);
    }
  }

  return (
    <main className="page match">
      <h1 className="visually-hidden">Match</h1>

      {load.kind === 'loading' && <p role="status">Loading your match…</p>}

      {load.kind === 'missing' && (
        <div className="match__problem">
          <p>This match isn't available any more.</p>
          <Link to={PATHS.home}>Back to songs</Link>
        </div>
      )}

      {load.kind === 'failed' && (
        <div className="match__problem" role="alert">
          <p>Couldn't load this match. Check your connection and try again.</p>
          <button
            type="button"
            className="match__button match__button--secondary"
            onClick={() => {
              setLoad({ kind: 'loading' });
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {load.kind === 'ready' && (
        <>
          <h2 className="match__title">You matched with {displayName(load.other)}!</h2>

          <div className="match__pair">
            <Person profile={load.self} label="You" />
            <span className="match__note" aria-hidden="true">
              ♫
            </span>
            <Person profile={load.other} label={displayName(load.other)} />
          </div>

          <p className="match__percent">{formatPercent(load.match.compatibilityPercent)} match!</p>
          <p className="match__question" id="match-question">
            Skip or play this match?
          </p>

          <div className="match__actions" role="group" aria-labelledby="match-question">
            <button
              type="button"
              className="match__button match__button--secondary"
              onClick={() => void answer(false)}
              disabled={answering}
            >
              <span aria-hidden="true">⏭ </span>Skip
            </button>
            <button
              type="button"
              className="match__button"
              onClick={() => void answer(true)}
              disabled={answering}
            >
              <span aria-hidden="true">▶ </span>Play
            </button>
          </div>

          {answerError !== null && (
            <p className="match__problem" role="alert">
              {answerError}
            </p>
          )}

          <button
            type="button"
            className="match__report"
            ref={reportButtonRef}
            onClick={() => setReportOpen(true)}
            disabled={answering}
          >
            Report {displayName(load.other)}
          </button>

          {reportOpen && (
            <Modal title={`Report ${displayName(load.other)}`} onClose={() => setReportOpen(false)} returnFocusTo={reportButtonRef}>
              <form className="auth-form" onSubmit={(event) => void submitReport(event)} noValidate aria-busy={reporting}>
                <fieldset className="match__reasons">
                  <legend>What is wrong with this profile?</legend>
                  {REPORT_REASONS.map((value) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="report-reason"
                        value={value}
                        checked={reason === value}
                        onChange={() => {
                          setReason(value);
                          setReportError(null);
                        }}
                      />
                      {REASON_LABELS[value]}
                    </label>
                  ))}
                </fieldset>
                <label htmlFor="report-details">Details (optional)</label>
                <textarea
                  id="report-details"
                  rows={3}
                  maxLength={MAX_REPORT_DETAILS}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                />
                <p className="match__hint">Reporting also skips this match. Only the Do~Re admins see your report.</p>
                {reportError !== null && (
                  <p className="match__problem" role="alert">
                    {reportError}
                  </p>
                )}
                <div className="match__actions">
                  <button type="button" className="match__button match__button--secondary" onClick={() => setReportOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="match__button" disabled={reporting}>
                    {reporting ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}
    </main>
  );
}

/** What each report reason says on screen. */
const REASON_LABELS: Record<ReportReason, string> = {
  FAKE_ACCOUNT: 'Fake account or pretending to be someone else',
  HARASSMENT: 'Harassment or threats',
  INAPPROPRIATE: 'Inappropriate name or picture',
  SPAM: 'Spam or advertising',
  OTHER: 'Something else',
};

/** One matched user: their round picture with their name under it. */
function Person({ profile, label }: { profile: UserProfile; label: string }) {
  return (
    <figure className="match__person">
      <Avatar profile={profile} label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
