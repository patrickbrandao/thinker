/* v8 ignore start -- dev-only preview, validated through browser QA. */
import type { AnimationPlaybackControls, AnimationSequence } from 'motion';
import { Show, onCleanup, onMount, type Component } from 'solid-js';
import type { OnboardingMessageSummary } from './welcome-helpers.js';

/**
 * Dev-only liftoff cinematic for the onboarding wizard (`/welcome?preview=liftoff`).
 * Welcome.tsx loads this module through a dynamic import inside the
 * `import.meta.env.DEV` branch, so neither its templates nor `motion` reach
 * the production bundle (#229).
 */
const WelcomeLiftoff: Component<{
  latestAgentRequest: OnboardingMessageSummary | null;
  harnessSlug: string;
  onLeave: () => void;
}> = (props) => {
  let liftoffRoot: HTMLElement | undefined;
  let liftoffStarsNear: HTMLElement | undefined;
  let liftoffStarsFar: HTMLElement | undefined;
  let liftoffFlash: HTMLElement | undefined;
  let liftoffOrbit: SVGSVGElement | undefined;
  let liftoffOrbitPath: SVGEllipseElement | undefined;
  let liftoffEarth: HTMLElement | undefined;
  let liftoffSmoke: HTMLElement | undefined;
  let liftoffRocket: HTMLElement | undefined;
  let liftoffPlume: HTMLElement | undefined;
  let liftoffInnerPlume: HTMLElement | undefined;
  let liftoffKicker: HTMLElement | undefined;
  let liftoffLaunchTitle: HTMLElement | undefined;
  let liftoffOrbitTitle: HTMLElement | undefined;
  let liftoffDescription: HTMLElement | undefined;
  let liftoffAction: HTMLElement | undefined;
  let liftoffStatus: HTMLElement | undefined;
  let liftoffAnimation: AnimationPlaybackControls | undefined;

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (
        !liftoffRoot ||
        !liftoffStarsNear ||
        !liftoffStarsFar ||
        !liftoffFlash ||
        !liftoffOrbit ||
        !liftoffOrbitPath ||
        !liftoffEarth ||
        !liftoffSmoke ||
        !liftoffRocket ||
        !liftoffPlume ||
        !liftoffInnerPlume ||
        !liftoffKicker ||
        !liftoffLaunchTitle ||
        !liftoffOrbitTitle ||
        !liftoffDescription ||
        !liftoffAction ||
        !liftoffStatus
      )
        return;

      void import('motion').then(({ animate }) => {
        if (cancelled) return;
        liftoffAnimation?.stop();
        const sequence: AnimationSequence = [
          [liftoffRoot, { opacity: [0, 1] }, { duration: 0.18, ease: 'easeOut', at: 0 }],
          [liftoffEarth, { opacity: [0, 0.74] }, { duration: 0.5, ease: 'easeOut', at: 0 }],
          [liftoffStarsFar, { opacity: [0, 0.3] }, { duration: 0.8, ease: 'easeOut', at: 0 }],
          [
            liftoffKicker,
            { opacity: [0, 1], y: [8, 0] },
            { duration: 0.45, ease: 'easeOut', at: 0.15 },
          ],
          [liftoffRocket, { opacity: [0, 1] }, { duration: 0.25, ease: 'easeOut', at: 0.05 }],
          // Ignition: the engine lights and the vehicle strains against the
          // pad before it moves — anticipation is what gives the rise weight.
          [
            liftoffInnerPlume,
            { opacity: [0, 1, 0.55, 1], scaleY: [0.2, 0.6, 0.5, 0.95] },
            { duration: 0.5, times: [0, 0.35, 0.55, 1], ease: 'linear', at: 0.3 },
          ],
          [
            liftoffInnerPlume,
            { opacity: [1, 1, 0], scaleY: [0.95, 1, 0.75] },
            { duration: 3.4, times: [0, 0.8, 1], ease: 'linear', at: 0.8 },
          ],
          [
            liftoffPlume,
            { opacity: [0, 0.85, 0.95, 0.85, 0], scaleY: [0.15, 0.85, 1, 1, 0.7] },
            { duration: 4, times: [0, 0.14, 0.4, 0.82, 1], ease: 'linear', at: 0.3 },
          ],
          [
            liftoffFlash,
            { opacity: [0, 0.85, 0.3, 0], scale: [0.2, 0.5, 0.95, 1.3] },
            { duration: 1.5, times: [0, 0.16, 0.55, 1], ease: 'easeOut', at: 0.32 },
          ],
          // Pad smoke billows and lingers instead of vanishing mid-ascent.
          [
            liftoffSmoke,
            {
              opacity: [0, 0.7, 0.45, 0],
              scaleX: [0.3, 1.05, 1.6, 2.1],
              scaleY: [0.5, 1, 1.2, 1.3],
              y: [0, -3, -9, -15],
            },
            { duration: 3.4, times: [0, 0.22, 0.6, 1], ease: 'easeOut', at: 0.35 },
          ],
          // Hold-down shake: jitter builds until release.
          [
            liftoffRocket,
            { x: [0, -1.2, 1.4, -1.8, 2.1, -1.4, 0.9, 0] },
            { duration: 0.62, ease: 'linear', at: 0.33 },
          ],
          // One continuous gravity turn. Evenly spaced keyframes with
          // quadratic-ish y spacing = constant acceleration (never a slowdown),
          // the pitch tracks the velocity vector, and the rocket leaves the
          // frame still under thrust — it never parks.
          [
            liftoffRocket,
            {
              y: ['0vh', '-1.5vh', '-6vh', '-14vh', '-26vh', '-42vh', '-62vh', '-86vh'],
              x: ['0vw', '0vw', '0.4vw', '1.5vw', '3.5vw', '7vw', '12vw', '18vw'],
              rotate: [0, 1, 8, 13, 17, 21, 24, 26],
              scale: [1, 1, 0.97, 0.93, 0.87, 0.8, 0.72, 0.64],
            },
            {
              duration: 3.4,
              ease: ['easeIn', 'linear', 'linear', 'linear', 'linear', 'linear', 'linear'],
              at: 0.95,
            },
          ],
          // Camera weight: the world falls away as the rocket gains speed.
          [
            liftoffStarsNear,
            { opacity: [0, 0.58], y: [0, '9vh'] },
            { duration: 3.5, ease: [0.55, 0, 0.85, 0.85], at: 0.95 },
          ],
          [
            liftoffStarsFar,
            { y: [0, '3vh'] },
            { duration: 3.5, ease: [0.55, 0, 0.85, 0.85], at: 0.95 },
          ],
          [
            liftoffEarth,
            { y: ['0%', '9%'] },
            { duration: 3.65, ease: [0.45, 0, 0.35, 1], at: 0.95 },
          ],
          [
            liftoffLaunchTitle,
            { opacity: [0, 1, 1, 0], y: [24, 0, 0, -14] },
            { duration: 3.1, times: [0, 0.15, 0.76, 1], ease: 'easeOut', at: 0.9 },
          ],
          [liftoffOrbit, { opacity: [0, 0.5] }, { duration: 0.35, ease: 'easeOut', at: 3.9 }],
          [
            liftoffOrbitPath,
            { opacity: [0, 0.48], pathLength: [0, 1] },
            { duration: 1.4, ease: [0.22, 0.61, 0.36, 1], at: 4 },
          ],
          [
            liftoffOrbitTitle,
            { opacity: [0, 1], y: [22, 0] },
            { duration: 0.78, ease: [0.16, 1, 0.3, 1], at: 4.6 },
          ],
          [
            liftoffDescription,
            { opacity: [0, 1], y: [10, 0] },
            { duration: 0.6, ease: 'easeOut', at: 4.95 },
          ],
          [
            liftoffStatus,
            { opacity: [0, 1], y: [6, 0] },
            { duration: 0.5, ease: 'easeOut', at: 5.05 },
          ],
          [
            liftoffAction,
            { opacity: [0, 1], y: [10, 0] },
            { duration: 0.6, ease: 'easeOut', at: 5.2 },
          ],
        ];
        liftoffAnimation = animate(sequence);
      });
    });

    onCleanup(() => {
      cancelled = true;
      cancelAnimationFrame(frame);
      liftoffAnimation?.stop();
      liftoffAnimation = undefined;
    });
  });

  return (
    <section
      ref={(element) => (liftoffRoot = element)}
      class="welcome__liftoff"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-liftoff-title"
      aria-describedby="welcome-liftoff-description"
    >
      <div
        ref={(element) => (liftoffStarsNear = element)}
        class="welcome__liftoff-stars welcome__liftoff-stars--near"
        aria-hidden="true"
      />
      <div
        ref={(element) => (liftoffStarsFar = element)}
        class="welcome__liftoff-stars welcome__liftoff-stars--far"
        aria-hidden="true"
      />
      <div
        ref={(element) => (liftoffFlash = element)}
        class="welcome__liftoff-flash"
        aria-hidden="true"
      />
      <svg
        ref={(element) => (liftoffOrbit = element)}
        class="welcome__liftoff-orbit"
        viewBox="0 0 1000 460"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <ellipse
          ref={(element) => (liftoffOrbitPath = element)}
          cx="500"
          cy="230"
          rx="496"
          ry="226"
          pathLength="1"
        />
        {/* The departed rocket, now a beacon on the orbit line (CSS-timed). */}
        <circle class="welcome__liftoff-beacon" cx="929" cy="117" r="5" />
      </svg>
      <div
        ref={(element) => (liftoffEarth = element)}
        class="welcome__liftoff-earth"
        aria-hidden="true"
      />
      <div
        ref={(element) => (liftoffSmoke = element)}
        class="welcome__liftoff-smoke"
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
      </div>

      <div
        ref={(element) => (liftoffRocket = element)}
        class="welcome__liftoff-rocket"
        aria-hidden="true"
      >
        <span ref={(element) => (liftoffPlume = element)} class="welcome__liftoff-plume" />
        <span
          ref={(element) => (liftoffInnerPlume = element)}
          class="welcome__liftoff-plume-inner"
        />
        <svg viewBox="0 0 100 148" fill="none">
          <path
            d="M50 4C30.7 24.8 25 60.5 29 94l21 21 21-21c4-33.5-1.7-69.2-21-90Z"
            fill="currentColor"
          />
          <path
            d="M50 4c-8.2 8.9-14.1 20.3-17.6 33.4h35.2C64.1 24.3 58.2 12.9 50 4Z"
            fill="white"
            fill-opacity=".16"
          />
          <circle
            cx="50"
            cy="55"
            r="11"
            fill="hsl(var(--background))"
            stroke="currentColor"
            stroke-opacity=".72"
            stroke-width="4"
          />
          <circle cx="47" cy="52" r="4" fill="currentColor" fill-opacity=".72" />
          <path
            d="M29.8 78 10 99v28l25-18M70.2 78 90 99v28l-25-18"
            fill="currentColor"
            stroke="currentColor"
            stroke-opacity=".26"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <path
            d="M39 110h22l-4 15H43l-4-15Z"
            fill="hsl(var(--muted))"
            stroke="currentColor"
            stroke-opacity=".36"
            stroke-width="2"
          />
        </svg>
      </div>

      <div class="welcome__liftoff-copy">
        <p ref={(element) => (liftoffKicker = element)} class="welcome__liftoff-kicker">
          Onboarding complete
        </p>
        <div class="welcome__liftoff-titles">
          <h1
            ref={(element) => (liftoffLaunchTitle = element)}
            class="welcome__liftoff-title welcome__liftoff-title--launch"
          >
            Liftoff
          </h1>
          <h1
            ref={(element) => (liftoffOrbitTitle = element)}
            id="welcome-liftoff-title"
            class="welcome__liftoff-title welcome__liftoff-title--orbit"
          >
            Orbit achieved
          </h1>
        </div>
        <p
          ref={(element) => (liftoffDescription = element)}
          id="welcome-liftoff-description"
          class="welcome__liftoff-description"
        >
          Your agent's first request just came through.
          <Show when={props.latestAgentRequest?.model}>
            {' '}
            Routed to {props.latestAgentRequest?.model}
            <Show when={props.latestAgentRequest?.duration_ms}>
              {' '}
              in {props.latestAgentRequest?.duration_ms} ms
            </Show>
            .
          </Show>
        </p>
      </div>

      {/* Exit cluster: reading ends top-left, the scene resolves bottom-right —
            status caption over the one action, at the Z-pattern terminus. */}
      <div class="welcome__liftoff-exit">
        <span
          ref={(element) => (liftoffStatus = element)}
          class="welcome__liftoff-status"
          aria-hidden="true"
        >
          {props.harnessSlug || 'agent'} · live
        </span>
        <button
          ref={(element) => (liftoffAction = element)}
          class="welcome__liftoff-action btn btn--primary"
          onClick={() => props.onLeave()}
        >
          Go to dashboard
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    </section>
  );
};

export default WelcomeLiftoff;
/* v8 ignore stop */
