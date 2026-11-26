import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusTrap } from './use-focus-trap';

function Dialog({ open }: { open: boolean }) {
  const container = useRef<HTMLDivElement | null>(null);
  const confirm = useRef<HTMLButtonElement | null>(null);
  useFocusTrap(container, open, confirm);

  return (
    <>
      <button type="button">Behind the dialog</button>
      {open ? (
        <div ref={container} role="dialog" aria-label="Confirm update">
          <button type="button" ref={confirm}>
            Confirm
          </button>
          <button type="button">Cancel</button>
        </div>
      ) : null}
    </>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the initial control when the dialog opens', () => {
    render(<Dialog open />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));
  });

  it('wraps Tab from the last control back to the first', async () => {
    const user = userEvent.setup();
    render(<Dialog open />);

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    cancel.focus();
    await user.tab();
    expect(document.activeElement).toBe(confirm);
  });

  it('wraps Shift+Tab from the first control to the last', async () => {
    const user = userEvent.setup();
    render(<Dialog open />);

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    confirm.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('gives focus back to what was focused before, when it closes', () => {
    const { rerender } = render(<Dialog open />);
    const behind = screen.getByRole('button', { name: 'Behind the dialog' });
    behind.focus();

    rerender(<Dialog open={false} />);
    expect(document.activeElement).toBe(behind);
  });
});
