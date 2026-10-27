import { Show, type ParentComponent } from 'solid-js';
import '../styles/organization.css';

interface ReadOnlyRegionProps {
  readOnly: boolean;
  /** Notice shown above the region when read-only. Omit to show none. */
  notice?: string;
}

/**
 * Wraps a page region in a disabled <fieldset> when the current role can't
 * change it: every button, input and select inside is disabled while links and
 * the data stay visible. The backend enforces the same rule.
 */
const ReadOnlyRegion: ParentComponent<ReadOnlyRegionProps> = (props) => (
  <>
    <Show when={props.readOnly && props.notice}>
      <div class="readonly-notice" role="note">
        {props.notice}
      </div>
    </Show>
    <fieldset class="readonly-region" disabled={props.readOnly}>
      {props.children}
    </fieldset>
  </>
);

export default ReadOnlyRegion;
