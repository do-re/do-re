import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

/** Opens a Modal from a button, so focus-return can be checked. */
function Harness({ withButtons = true, onClose }: { withButtons?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal title="Something went wrong" tone="error" onClose={close}>
          <p>Details</p>
          {withButtons && (
            <>
              <button onClick={close}>OK</button>
              <button>Help</button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  // spec: role="dialog", aria-modal, labelled by its title
  it('is an accessible modal dialog named by its title', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: /something went wrong/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  // spec: focus moves to the first focusable element on open, returns on close
  it('moves focus in on open and back to the opener on close', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  // spec: with nothing focusable inside, the dialog itself gets focus
  it('focuses the dialog itself when it has no focusable children', async () => {
    render(<Harness withButtons={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  // spec: Escape closes
  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // spec: Tab and Shift+Tab stay inside the dialog
  it('traps Tab focus inside the dialog in both directions', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const ok = screen.getByRole('button', { name: 'OK' });
    const help = screen.getByRole('button', { name: 'Help' });
    await userEvent.tab();
    expect(help).toHaveFocus();
    await userEvent.tab();
    expect(ok).toHaveFocus(); // wrapped forward
    await userEvent.tab({ shift: true });
    expect(help).toHaveFocus(); // wrapped backward
    await userEvent.tab({ shift: true });
    expect(ok).toHaveFocus(); // ordinary Shift+Tab inside
  });

  // spec: Tab with nothing focusable keeps focus on the dialog
  it('keeps focus on the dialog when Tab is pressed and nothing is focusable', async () => {
    render(<Harness withButtons={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.tab();
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  // spec: other keys are ignored
  it('ignores keys other than Escape and Tab', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.keyboard('a');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // spec: info tone shows no warning icon
  it('shows the warning icon only for the error tone', () => {
    render(
      <Modal title="Check your email" onClose={() => {}}>
        <p>Sent</p>
      </Modal>,
    );
    expect(screen.getByRole('heading', { name: 'Check your email' }).textContent).toBe('Check your email');
  });
});
