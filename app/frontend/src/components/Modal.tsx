/**
 * Accessible modal dialog, used for every popup on LoginView, CreateAccountView and
 * ProfileView (CLAUDE.md web practice; stub showErrorPopup / showVerificationPopup).
 *
 * Behaviour: role="dialog" + aria-modal, labelled by its title; focus moves to the first
 * focusable element on open (or the dialog itself) and returns to the previously focused
 * element on close; Escape closes; Tab and Shift+Tab stay inside the dialog.
 *
 * The parent controls visibility by rendering or not rendering <Modal>.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** Heading shown at the top and used as the dialog's accessible name. Requires: non-empty. */
  readonly title: string;
  /** Called when the user presses Escape. Buttons inside `children` call their own handlers. */
  readonly onClose: () => void;
  /** Optional visual tone. "error" adds the warning icon from the sketch. */
  readonly tone?: 'info' | 'error';
  /**
   * Where focus goes when the dialog closes. Defaults to whatever was focused when it opened.
   * Use it when that element may be gone or disabled (e.g. a submit button disabled while a
   * request was pending), so focus lands somewhere useful, such as the field to fix.
   */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}

/**
 * Requires: title is non-empty.
 * Effects: while mounted, shows a modal dialog and manages focus as described above.
 */
export function Modal({ title, onClose, tone = 'info', returnFocusTo, children }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const returnTarget = returnFocusTo?.current ?? (document.activeElement as HTMLElement | null);
    const dialog = dialogRef.current!;
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog).focus();
    return () => returnTarget?.focus?.();
  }, [returnFocusTo]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialogRef.current!.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className={`modal modal--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="modal__title">
          {tone === 'error' && <span aria-hidden="true">⚠ </span>}
          {title}
        </h2>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
