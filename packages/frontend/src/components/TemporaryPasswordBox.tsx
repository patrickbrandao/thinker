import type { Component } from 'solid-js';
import CopyButton from './CopyButton.jsx';
import '../styles/organization.css';

interface TemporaryPasswordBoxProps {
  /** Who the password belongs to, shown in the title. */
  email: string;
  password: string;
  onDismiss: () => void;
}

/**
 * Shows a server-generated temporary password exactly once. The caller drops
 * it from state on dismiss; nothing is persisted.
 */
const TemporaryPasswordBox: Component<TemporaryPasswordBoxProps> = (props) => (
  <div class="temp-password" role="status">
    <span class="temp-password__title">Temporary password for {props.email}</span>
    <span class="temp-password__warning">
      Copy it now and share it securely. It will not be shown again. The user must choose a new
      password at the first sign-in.
    </span>
    <div class="temp-password__row">
      <code class="temp-password__value" data-testid="temporary-password">
        {props.password}
      </code>
      <CopyButton text={props.password} />
    </div>
    <div class="temp-password__actions">
      <button type="button" class="btn btn--outline btn--sm" onClick={() => props.onDismiss()}>
        I saved it
      </button>
    </div>
  </div>
);

export default TemporaryPasswordBox;
