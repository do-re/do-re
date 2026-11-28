/**
 * AdminView: the /admin page (OPEN-18; not in the Java stubs; owner Felix). Three tabs:
 *   Users     every account, with suspend / unsuspend, verify and admin-rights actions;
 *   Reports   reports about profiles, open ones first, with resolve and a shortcut to suspend;
 *   Activity  the log of admin actions.
 *
 * The server decides who is an admin on every request. This page only reflects that: if the
 * server says the user is not an admin, the page sends them Home.
 *
 * Communicates with: AdminController (via useApi()), ViewController (via the router).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiContext';
import { ApiError } from '../api/apiErrors';
import { MAX_SUSPEND_REASON, type AdminReport, type AdminUser, type AuditEntry } from '../api/types';
import { Modal } from '../components/Modal';
import { PATHS } from '../paths';
import { useSession } from '../session/SessionContext';
import './admin.css';

type Tab = 'users' | 'reports' | 'activity';
type Data = { users: AdminUser[]; reports: AdminReport[]; entries: AuditEntry[] };
type LoadState = { kind: 'loading' } | { kind: 'failed' } | ({ kind: 'ready' } & Data);

const REASON_TEXT: Record<AdminReport['reason'], string> = {
  FAKE_ACCOUNT: 'Fake account',
  HARASSMENT: 'Harassment',
  INAPPROPRIATE: 'Inappropriate name or picture',
  SPAM: 'Spam',
  OTHER: 'Something else',
  REPORTED_IN_CHAT: 'Reported from a chat',
};

const ACTION_TEXT: Record<AuditEntry['action'], string> = {
  SUSPEND: 'suspended',
  UNSUSPEND: 'unsuspended',
  VERIFY: 'verified',
  GRANT_ADMIN: 'made an admin of',
  REVOKE_ADMIN: 'removed admin rights from',
  RESOLVE_REPORT: 'resolved the report',
};

const when = (time: number | null) => (time === null ? 'never' : new Date(time).toLocaleString());

/**
 * The /admin page.
 * Requires: rendered inside ApiProvider, SessionProvider (with a logged-in user) and a router.
 * Effects: loads the users, reports and activity log; sends a user who is not an admin Home.
 */
export function AdminView() {
  const api = useApi();
  const adminId = useSession().userId!;
  const navigate = useNavigate();

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('users');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<{ userId: string; email: string } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [attempt, setAttempt] = useState(0);

  const fetchAll = useCallback(
    async (): Promise<Data> => {
      const [users, reports, entries] = await Promise.all([
        api.admin.listUsers(adminId),
        api.admin.listReports(adminId),
        api.admin.auditLog(adminId),
      ]);
      return { users, reports, entries };
    },
    [api, adminId],
  );

  /** A failed load: not an admin (the server said 403) goes Home; anything else offers a retry. */
  const onLoadFailed = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 403) navigate(PATHS.home, { replace: true });
      else setLoad({ kind: 'failed' });
    },
    [navigate],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(
      (data) => !cancelled && setLoad({ kind: 'ready', ...data }),
      (error: unknown) => !cancelled && onLoadFailed(error),
    );
    return () => {
      cancelled = true;
    };
  }, [fetchAll, onLoadFailed, attempt]);

  /** Loads the page's data again after an action. */
  async function reload() {
    try {
      setLoad({ kind: 'ready', ...(await fetchAll()) });
    } catch (error) {
      onLoadFailed(error);
    }
  }

  /**
   * Requires: none.
   * Effects: runs one admin action with every action button disabled, then reloads the page's
   *          data. If the server refuses, shows its message (it says what the rule is).
   * @returns true iff the action succeeded
   */
  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      await reload();
      return true;
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openSuspend(userId: string, email: string) {
    setSuspending({ userId, email });
    setReason('');
    setReasonError(null);
  }

  async function submitSuspend(event: FormEvent) {
    event.preventDefault();
    if (suspending === null || busy) return;
    const why = reason.trim();
    if (why === '') {
      setReasonError('Give a reason, so other admins know why.');
      return;
    }
    const target = suspending;
    if (await run(() => api.admin.suspend(adminId, target.userId, why))) setSuspending(null);
  }

  if (load.kind === 'loading') {
    return (
      <main className="page admin">
        <h1>Admin</h1>
        <p role="status">Loading…</p>
      </main>
    );
  }
  if (load.kind === 'failed') {
    return (
      <main className="page admin">
        <h1>Admin</h1>
        <div role="alert">
          <p>Couldn't load the admin page. Check your connection and try again.</p>
          <button
            type="button"
            className="admin__button"
            onClick={() => {
              setLoad({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const { users, reports, entries } = load;
  const emailOf = new Map(users.map((user) => [user.userId, user.email]));
  const needle = search.trim().toLowerCase();
  const shown = users.filter((user) => needle === '' || user.email.includes(needle) || user.username.toLowerCase().includes(needle));
  const openReports = reports.filter((report) => report.resolved === null).length;
  const tabs: [Tab, string][] = [
    ['users', `Users (${users.length})`],
    ['reports', `Reports (${openReports} open)`],
    ['activity', 'Activity'],
  ];

  return (
    <main className="page admin">
      <h1 ref={headingRef} tabIndex={-1}>
        Admin
      </h1>

      <div className="admin__tabs" role="tablist" aria-label="Admin sections">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`admin-tab-${id}`} aria-selected={tab === id} aria-controls="admin-panel" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {problem !== null && (
        <p className="admin__problem" role="alert">
          {problem}
        </p>
      )}

      <section id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'users' && (
          <>
            <label htmlFor="admin-search" className="admin__search">
              Search users
              <input id="admin-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Email or username" />
            </label>
            {shown.length === 0 ? (
              <p>No users match that search.</p>
            ) : (
              <ul className="admin__list">
                {shown.map((user) => (
                  <UserRow
                    key={user.userId}
                    user={user}
                    isSelf={user.userId === adminId}
                    busy={busy}
                    onSuspend={() => openSuspend(user.userId, user.email)}
                    onUnsuspend={() => void run(() => api.admin.unsuspend(adminId, user.userId))}
                    onVerify={() => void run(() => api.admin.verify(adminId, user.userId))}
                    onSetAdmin={(admin) => void run(() => api.admin.setAdmin(adminId, user.userId, admin))}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'reports' &&
          (reports.length === 0 ? (
            <p>No one has been reported.</p>
          ) : (
            <ul className="admin__list">
              {reports.map((report) => {
                const reportedUser = users.find((user) => user.userId === report.reported.userId);
                const canSuspend = reportedUser !== undefined && reportedUser.suspended === null && !reportedUser.rootAdmin && reportedUser.userId !== adminId;
                return (
                  <li key={report.reportId} className="admin__card" aria-label={`Report about ${report.reported.email || 'a deleted account'}`}>
                    <p className="admin__line">
                      <strong>{report.reported.email || 'Deleted account'}</strong>
                      {report.reported.username !== '' && ` (${report.reported.username})`}
                      <span className={report.resolved === null ? 'admin__tag admin__tag--warn' : 'admin__tag'}>
                        {report.resolved === null ? 'Open' : 'Resolved'}
                      </span>
                    </p>
                    <p>
                      {REASON_TEXT[report.reason]}, from the {report.source === 'MATCH' ? 'match screen' : 'chat'}, {when(report.createdAt)}
                    </p>
                    {report.details !== '' && <p className="admin__quote">“{report.details}”</p>}
                    <p className="admin__meta">Reported by {report.reporter.email || 'a deleted account'}</p>
                    {reportedUser?.suspended && <p className="admin__meta">This user is suspended.</p>}
                    {report.resolved !== null && (
                      <p className="admin__meta">
                        Resolved by {emailOf.get(report.resolved.by) ?? 'an admin'}, {when(report.resolved.at)}
                        {report.resolved.note !== '' && `: ${report.resolved.note}`}
                      </p>
                    )}
                    <div className="admin__actions">
                      {report.resolved === null && (
                        <button type="button" className="admin__button" disabled={busy} onClick={() => void run(() => api.admin.resolveReport(adminId, report.reportId, ''))}>
                          Resolve
                        </button>
                      )}
                      {canSuspend && (
                        <button type="button" className="admin__button admin__button--danger" disabled={busy} onClick={() => openSuspend(report.reported.userId, report.reported.email)}>
                          Suspend user
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ))}

        {tab === 'activity' &&
          (entries.length === 0 ? (
            <p>No admin has done anything yet.</p>
          ) : (
            <ul className="admin__list">
              {entries.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="admin__card">
                  <p>
                    <strong>{emailOf.get(entry.adminId) ?? 'An admin'}</strong> {ACTION_TEXT[entry.action]}{' '}
                    {entry.action === 'RESOLVE_REPORT' ? `about ${emailOf.get(entry.targetId.split('.')[0]) ?? 'a user'}` : (emailOf.get(entry.targetId) ?? 'a user')}
                    {entry.detail !== '' && `: ${entry.detail}`}
                  </p>
                  <p className="admin__meta">{when(entry.at)}</p>
                </li>
              ))}
            </ul>
          ))}
      </section>

      {suspending !== null && (
        <Modal title={`Suspend ${suspending.email}`} tone="error" onClose={() => setSuspending(null)} returnFocusTo={headingRef}>
          <form className="auth-form" onSubmit={(event) => void submitSuspend(event)} noValidate aria-busy={busy}>
            <p>They will be logged out, unable to log in, and removed from matching until an admin unsuspends them.</p>
            <label htmlFor="suspend-reason">Reason</label>
            <textarea
              id="suspend-reason"
              rows={3}
              maxLength={MAX_SUSPEND_REASON}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
              }}
              aria-invalid={reasonError !== null}
              aria-describedby={reasonError !== null ? 'suspend-reason-error' : undefined}
            />
            {reasonError !== null && (
              <p id="suspend-reason-error" className="admin__problem" role="alert">
                {reasonError}
              </p>
            )}
            {problem !== null && (
              <p className="admin__problem" role="alert">
                {problem}
              </p>
            )}
            <div className="admin__actions">
              <button type="button" className="admin__button" onClick={() => setSuspending(null)}>
                Cancel
              </button>
              <button type="submit" className="admin__button admin__button--danger" disabled={busy}>
                {busy ? 'Suspending…' : 'Suspend'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

interface UserRowProps {
  readonly user: AdminUser;
  readonly isSelf: boolean;
  readonly busy: boolean;
  onSuspend(): void;
  onUnsuspend(): void;
  onVerify(): void;
  onSetAdmin(admin: boolean): void;
}

/** One user: who they are, their state, and the actions the rules allow on them. */
function UserRow({ user, isSelf, busy, onSuspend, onUnsuspend, onVerify, onSetAdmin }: UserRowProps) {
  // The server enforces these rules too; here they explain why a button is missing.
  const locked = isSelf ? 'This is you.' : user.rootAdmin ? 'Root admin: set in the server configuration.' : null;
  return (
    <li className="admin__card" aria-label={user.email}>
      <p className="admin__line">
        <strong>{user.email}</strong>
        {user.username !== '' && ` (${user.username})`}
        {user.rootAdmin ? <span className="admin__tag">Root admin</span> : user.admin && <span className="admin__tag">Admin</span>}
        {!user.active && <span className="admin__tag admin__tag--warn">Not verified</span>}
        {user.suspended !== null && <span className="admin__tag admin__tag--warn">Suspended</span>}
        {user.openReports > 0 && (
          <span className="admin__tag admin__tag--warn">
            {user.openReports} open {user.openReports === 1 ? 'report' : 'reports'}
          </span>
        )}
      </p>
      <p className="admin__meta">
        Joined {when(user.createdAt)}. Last swiped: {when(user.lastActiveAt)}.
      </p>
      {user.suspended !== null && <p className="admin__meta">Suspended {when(user.suspended.at)}: {user.suspended.reason}</p>}
      {locked !== null && <p className="admin__meta">{locked}</p>}
      <div className="admin__actions">
        {!user.active && (
          <button type="button" className="admin__button" disabled={busy} onClick={onVerify}>
            Verify email
          </button>
        )}
        {user.suspended !== null && (
          <button type="button" className="admin__button" disabled={busy} onClick={onUnsuspend}>
            Unsuspend
          </button>
        )}
        {locked === null && user.suspended === null && (
          <button type="button" className="admin__button admin__button--danger" disabled={busy} onClick={onSuspend}>
            Suspend
          </button>
        )}
        {locked === null && (
          <button type="button" className="admin__button" disabled={busy} onClick={() => onSetAdmin(!user.admin)}>
            {user.admin ? 'Remove admin' : 'Make admin'}
          </button>
        )}
      </div>
    </li>
  );
}
