/**
 * A labelled text input with an optional error message under it. The message is linked to
 * the input (aria-describedby) and marks it invalid (aria-invalid), so screen readers read it.
 * Used by LoginView and CreateAccountView.
 */
import type { InputHTMLAttributes, Ref } from 'react';

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'aria-invalid' | 'aria-describedby'> {
  /** The input's id. Requires: unique on the page. */
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Called with the new text on every edit. */
  readonly onValueChange: (value: string) => void;
  /** What the user must fix, or undefined when the field is fine. */
  readonly error?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * Requires: id is unique on the page.
 * Effects: renders the label, the input and, if error is set, the error message.
 */
export function TextField({ id, label, value, onValueChange, error, inputRef, ...inputProps }: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        ref={inputRef}
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

/** The "Do~Re" wordmark from the sketch, shown at the top of the login and sign-up pages. */
export function Wordmark() {
  return (
    <p className="wordmark">
      <span aria-hidden="true">♫ </span>Do~Re<span aria-hidden="true"> 𝄞</span>
    </p>
  );
}
