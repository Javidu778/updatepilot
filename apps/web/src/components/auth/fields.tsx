'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  /** Error text for this field. Linked to the input so screen readers read it with the label. */
  error?: string;
  hint?: string;
  /** Something shown inside the field's right edge, such as the show/hide button. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({ label, error, hint, trailing, ref, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="form-field">
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      <div className="input-wrap">
        <input
          {...input}
          id={id}
          ref={ref}
          className="form-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        {trailing}
      </div>
      {hint ? (
        <p id={hintId} className="form-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trailing'>;

/** A password input with a button that shows or hides what was typed. */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          className="input-action"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          <Icon aria-hidden="true" size={18} />
        </button>
      }
    />
  );
}
