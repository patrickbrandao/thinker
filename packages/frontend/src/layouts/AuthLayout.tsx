import type { ParentComponent } from 'solid-js';
import { THINKER_LOGO_URL, THINKER_LOGO_DARK_URL } from '../services/thinker-links.js';

const AuthLayout: ParentComponent = (props) => {
  return (
    <div class="auth-layout">
      <div class="auth-card">
        <div class="auth-logo">
          <img src={THINKER_LOGO_URL} alt="Thinker" class="auth-logo__img auth-logo__img--light" />
          <img src={THINKER_LOGO_DARK_URL} alt="" class="auth-logo__img auth-logo__img--dark" />
        </div>
        {props.children}
      </div>
    </div>
  );
};

export default AuthLayout;
