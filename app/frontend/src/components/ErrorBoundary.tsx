/**
 * Catches a crash while rendering a page, so the user sees what to do instead of a blank screen.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** What the reload button does. Defaults to reloading the page; tests pass a fake. */
  readonly onReload?: () => void;
}

/**
 * Requires: none.
 * Effects: renders children; if one throws while rendering, shows an error page with a reload
 *          button instead. Only the error's name is logged, since its message could hold user data.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('Do~Re page crashed:', error.name);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.onReload ?? (() => window.location.reload());
    return (
      <main className="page" role="alert">
        <h1>Something went wrong</h1>
        <p>Reload the page to keep going.</p>
        <button type="button" className="button-primary" onClick={reload}>
          Reload
        </button>
      </main>
    );
  }
}
