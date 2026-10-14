import { Show } from 'solid-js';

/**
 * Bottom-corner `vX.Y.Z` badge. The version is a build-time constant injected
 * by `vite.config.ts` from the canonical package.json, so the badge makes no
 * request at all: Thinker never checks for updates on its own.
 */
const VersionIndicator = () => {
  const version = __THINKER_VERSION__;

  return (
    <Show when={version}>
      <div class="version-indicator" aria-label={`Version ${version}`}>
        <span>v{version}</span>
      </div>
    </Show>
  );
};

export default VersionIndicator;
