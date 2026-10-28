/* v8 ignore start -- dev-only preview, validated through browser QA. */
import { useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AnimationPlaybackControls, AnimationSequence } from 'motion';
import type { OnboardingMessageSummary } from './welcome-helpers.js';
import { Button } from '../components/ui.jsx';
import { t } from '../i18n/index.js';

// Three offset layers of tiny dots; the two star fields share them.
const STARS_CLASS = [
  'absolute inset-0 opacity-0 will-change-[opacity,transform]',
  `bg-[radial-gradient(circle,color-mix(in_oklab,var(--text)_78%,transparent)_0_1px,transparent_1.4px),radial-gradient(circle,color-mix(in_oklab,var(--text)_52%,transparent)_0_0.8px,transparent_1.2px),radial-gradient(circle,color-mix(in_oklab,var(--text)_32%,transparent)_0_0.7px,transparent_1px)]`,
  'bg-[position:13px_19px,71px_43px,29px_81px] bg-[size:109px_127px,163px_181px,97px_149px]',
].join(' ');

const SMOKE_PUFF = `absolute bottom-0 h-[70%] w-[42%] rounded-full blur-[4px] bg-[radial-gradient(ellipse,color-mix(in_oklab,var(--text)_17%,transparent),transparent_70%)]`;

/**
 * Dev-only liftoff cinematic for the onboarding wizard (`/welcome?preview=liftoff`).
 * Welcome.tsx loads this module through a dynamic import inside the
 * `import.meta.env.DEV` branch, so neither its templates nor `motion` reach
 * the production bundle (#229).
 */
export default function WelcomeLiftoff({
  latestAgentRequest,
  harnessSlug,
  onLeave,
}: {
  latestAgentRequest: OnboardingMessageSummary | null;
  harnessSlug: string;
  onLeave: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const starsNear = useRef<HTMLDivElement>(null);
  const starsFar = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const orbit = useRef<SVGSVGElement>(null);
  const orbitPath = useRef<SVGEllipseElement>(null);
  const beacon = useRef<SVGCircleElement>(null);
  const earth = useRef<HTMLDivElement>(null);
  const smoke = useRef<HTMLDivElement>(null);
  const rocket = useRef<HTMLDivElement>(null);
  const plume = useRef<HTMLSpanElement>(null);
  const innerPlume = useRef<HTMLSpanElement>(null);
  const kicker = useRef<HTMLParagraphElement>(null);
  const launchTitle = useRef<HTMLHeadingElement>(null);
  const orbitTitle = useRef<HTMLHeadingElement>(null);
  const description = useRef<HTMLParagraphElement>(null);
  const action = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Show the end state without the animation.
      for (const el of [
        root,
        earth,
        starsFar,
        kicker,
        orbit,
        orbitPath,
        orbitTitle,
        description,
        status,
        action,
      ])
        el.current?.style.setProperty('opacity', '1');
      return;
    }

    let cancelled = false;
    let animation: AnimationPlaybackControls | undefined;
    const frame = requestAnimationFrame(() => {
      const els = [
        root.current,
        starsNear.current,
        starsFar.current,
        flash.current,
        orbit.current,
        orbitPath.current,
        beacon.current,
        earth.current,
        smoke.current,
        rocket.current,
        plume.current,
        innerPlume.current,
        kicker.current,
        launchTitle.current,
        orbitTitle.current,
        description.current,
        action.current,
        status.current,
      ];
      if (els.some((el) => !el)) return;

      void import('motion').then(({ animate }) => {
        if (cancelled) return;
        const sequence: AnimationSequence = [
          [root.current!, { opacity: [0, 1] }, { duration: 0.18, ease: 'easeOut', at: 0 }],
          [earth.current!, { opacity: [0, 0.74] }, { duration: 0.5, ease: 'easeOut', at: 0 }],
          [starsFar.current!, { opacity: [0, 0.3] }, { duration: 0.8, ease: 'easeOut', at: 0 }],
          [
            kicker.current!,
            { opacity: [0, 1], y: [8, 0] },
            { duration: 0.45, ease: 'easeOut', at: 0.15 },
          ],
          [rocket.current!, { opacity: [0, 1] }, { duration: 0.25, ease: 'easeOut', at: 0.05 }],
          // Ignition: the engine lights and the vehicle strains against the
          // pad before it moves — anticipation is what gives the rise weight.
          [
            innerPlume.current!,
            { opacity: [0, 1, 0.55, 1], scaleY: [0.2, 0.6, 0.5, 0.95] },
            { duration: 0.5, times: [0, 0.35, 0.55, 1], ease: 'linear', at: 0.3 },
          ],
          [
            innerPlume.current!,
            { opacity: [1, 1, 0], scaleY: [0.95, 1, 0.75] },
            { duration: 3.4, times: [0, 0.8, 1], ease: 'linear', at: 0.8 },
          ],
          [
            plume.current!,
            { opacity: [0, 0.85, 0.95, 0.85, 0], scaleY: [0.15, 0.85, 1, 1, 0.7] },
            { duration: 4, times: [0, 0.14, 0.4, 0.82, 1], ease: 'linear', at: 0.3 },
          ],
          [
            flash.current!,
            { opacity: [0, 0.85, 0.3, 0], scale: [0.2, 0.5, 0.95, 1.3] },
            { duration: 1.5, times: [0, 0.16, 0.55, 1], ease: 'easeOut', at: 0.32 },
          ],
          // Pad smoke billows and lingers instead of vanishing mid-ascent.
          [
            smoke.current!,
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
            rocket.current!,
            { x: [0, -1.2, 1.4, -1.8, 2.1, -1.4, 0.9, 0] },
            { duration: 0.62, ease: 'linear', at: 0.33 },
          ],
          // One continuous gravity turn. Evenly spaced keyframes with
          // quadratic-ish y spacing = constant acceleration (never a slowdown),
          // the pitch tracks the velocity vector, and the rocket leaves the
          // frame still under thrust — it never parks.
          [
            rocket.current!,
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
            starsNear.current!,
            { opacity: [0, 0.58], y: [0, '9vh'] },
            { duration: 3.5, ease: [0.55, 0, 0.85, 0.85], at: 0.95 },
          ],
          [
            starsFar.current!,
            { y: [0, '3vh'] },
            { duration: 3.5, ease: [0.55, 0, 0.85, 0.85], at: 0.95 },
          ],
          [
            earth.current!,
            { y: ['0%', '9%'] },
            { duration: 3.65, ease: [0.45, 0, 0.35, 1], at: 0.95 },
          ],
          [
            launchTitle.current!,
            { opacity: [0, 1, 1, 0], y: [24, 0, 0, -14] },
            { duration: 3.1, times: [0, 0.15, 0.76, 1], ease: 'easeOut', at: 0.9 },
          ],
          [orbit.current!, { opacity: [0, 0.5] }, { duration: 0.35, ease: 'easeOut', at: 3.9 }],
          [
            orbitPath.current!,
            { opacity: [0, 0.48], pathLength: [0, 1] },
            { duration: 1.4, ease: [0.22, 0.61, 0.36, 1], at: 4 },
          ],
          // The departed rocket, now a beacon on the orbit line.
          [beacon.current!, { opacity: [0, 0.95] }, { duration: 0.45, ease: 'easeOut', at: 5.05 }],
          [
            orbitTitle.current!,
            { opacity: [0, 1], y: [22, 0] },
            { duration: 0.78, ease: [0.16, 1, 0.3, 1], at: 4.6 },
          ],
          [
            description.current!,
            { opacity: [0, 1], y: [10, 0] },
            { duration: 0.6, ease: 'easeOut', at: 4.95 },
          ],
          [
            status.current!,
            { opacity: [0, 1], y: [6, 0] },
            { duration: 0.5, ease: 'easeOut', at: 5.05 },
          ],
          [
            action.current!,
            { opacity: [0, 1], y: [10, 0] },
            { duration: 0.6, ease: 'easeOut', at: 5.2 },
          ],
        ];
        animation = animate(sequence);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      animation?.stop();
    };
  }, []);

  return (
    <section
      ref={root}
      className="fixed inset-0 z-[1000] isolate overflow-hidden text-ink opacity-0 [contain:strict] bg-bg bg-[radial-gradient(circle_at_50%_112%,color-mix(in_oklab,var(--text)_5.5%,transparent),transparent_42%),radial-gradient(circle_at_78%_12%,color-mix(in_oklab,var(--ok)_3.5%,transparent),transparent_28%)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-liftoff-title"
      aria-describedby="welcome-liftoff-description"
    >
      <div ref={starsNear} className={STARS_CLASS} aria-hidden="true" />
      <div ref={starsFar} className={STARS_CLASS} aria-hidden="true" />
      <div
        ref={flash}
        className="absolute bottom-[2vh] left-1/2 z-[3] size-[34vw] min-h-[320px] min-w-[320px] -translate-x-1/2 translate-y-1/2 rounded-full opacity-0 bg-[radial-gradient(circle,color-mix(in_oklab,var(--text)_96%,transparent)_0%,color-mix(in_oklab,var(--ok)_62%,transparent)_9%,color-mix(in_oklab,var(--ok)_16%,transparent)_28%,transparent_69%)]"
        aria-hidden="true"
      />
      <svg
        ref={orbit}
        className="absolute left-1/2 top-[13%] z-[2] h-[min(48vh,460px)] w-[min(72vw,1100px)] -translate-x-1/2 -rotate-9 overflow-visible opacity-0"
        viewBox="0 0 1000 460"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <ellipse
          ref={orbitPath}
          className="fill-none stroke-[1.5] [stroke:var(--text-muted)] [vector-effect:non-scaling-stroke]"
          cx="500"
          cy="230"
          rx="496"
          ry="226"
          pathLength="1"
        />
        <g className="animate-pulse">
          <circle ref={beacon} className="fill-ok opacity-0" cx="929" cy="117" r="5" />
        </g>
      </svg>
      <div
        ref={earth}
        className="absolute bottom-[min(-61vw,-780px)] left-1/2 z-[1] h-[max(72vw,920px)] w-[max(138vw,1760px)] -translate-x-1/2 rounded-full border opacity-0 [border-color:color-mix(in_oklab,var(--text)_42%,transparent)] bg-[radial-gradient(circle_at_50%_0%,var(--surface-2)_0%,var(--bg-elev)_30%,var(--bg)_67%)]"
        aria-hidden="true"
      />
      <div
        ref={smoke}
        className="absolute bottom-[8vh] left-1/2 z-[4] h-[58px] w-[clamp(190px,24vw,340px)] -translate-x-1/2 origin-bottom opacity-0"
        aria-hidden="true"
      >
        <span className={`${SMOKE_PUFF} left-[6%]`} />
        <span className={`${SMOKE_PUFF} bottom-2 left-[29%]`} />
        <span className={`${SMOKE_PUFF} right-[6%]`} />
      </div>

      <div
        ref={rocket}
        className="absolute bottom-[12vh] left-1/2 z-[5] w-[clamp(66px,6.5vw,102px)] -translate-x-1/2 text-ink opacity-0 [backface-visibility:hidden]"
        aria-hidden="true"
      >
        <span
          ref={plume}
          className="absolute left-1/2 top-[78%] z-[1] h-[clamp(92px,16vh,180px)] w-[42%] -translate-x-1/2 origin-top rounded-[50%_50%_80%_80%] opacity-0 blur-[1px] bg-[linear-gradient(180deg,var(--text)_0%,color-mix(in_oklab,var(--text)_78%,transparent)_12%,color-mix(in_oklab,var(--ok)_28%,transparent)_35%,color-mix(in_oklab,var(--ok)_6%,transparent)_68%,transparent_100%)]"
        />
        <span
          ref={innerPlume}
          className="absolute left-1/2 top-[79%] z-[2] h-[clamp(52px,9vh,105px)] w-[16%] -translate-x-1/2 origin-top rounded-[45%_45%_70%_70%] opacity-0 bg-[linear-gradient(180deg,var(--text)_0%,color-mix(in_oklab,var(--text)_62%,transparent)_38%,transparent_100%)]"
        />
        <svg className="relative z-[2] block h-auto w-full" viewBox="0 0 100 148" fill="none">
          <path
            d="M50 4C30.7 24.8 25 60.5 29 94l21 21 21-21c4-33.5-1.7-69.2-21-90Z"
            fill="currentColor"
          />
          <path
            d="M50 4c-8.2 8.9-14.1 20.3-17.6 33.4h35.2C64.1 24.3 58.2 12.9 50 4Z"
            className="fill-bg"
            fillOpacity=".16"
          />
          <circle
            cx="50"
            cy="55"
            r="11"
            className="fill-bg"
            stroke="currentColor"
            strokeOpacity=".72"
            strokeWidth="4"
          />
          <circle cx="47" cy="52" r="4" fill="currentColor" fillOpacity=".72" />
          <path
            d="M29.8 78 10 99v28l25-18M70.2 78 90 99v28l-25-18"
            fill="currentColor"
            stroke="currentColor"
            strokeOpacity=".26"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M39 110h22l-4 15H43l-4-15Z"
            className="fill-s3"
            stroke="currentColor"
            strokeOpacity=".36"
            strokeWidth="2"
          />
        </svg>
      </div>

      <div className="absolute left-[clamp(28px,7vw,110px)] top-[clamp(54px,9vh,112px)] z-[8] max-w-[min(620px,78vw)]">
        <p
          ref={kicker}
          className="m-0 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted opacity-0"
        >
          {t('welcome.liftoff.kicker')}
        </p>
        <div className="mt-3 grid">
          <h1
            ref={launchTitle}
            className="m-0 text-[clamp(60px,10vw,154px)] font-bold leading-[0.86] tracking-[-0.065em] opacity-0 [grid-area:1/1] [text-wrap:balance]"
          >
            {t('welcome.liftoff.launch')}
          </h1>
          <h1
            ref={orbitTitle}
            id="welcome-liftoff-title"
            className="m-0 max-w-[780px] text-[clamp(48px,8.3vw,126px)] font-bold leading-[0.86] tracking-[-0.065em] opacity-0 [grid-area:1/1] [text-wrap:balance]"
          >
            {t('welcome.liftoff.orbit')}
          </h1>
        </div>
        <p
          ref={description}
          id="welcome-liftoff-description"
          className="mt-[22px] max-w-[520px] text-[clamp(14px,1.45vw,18px)] leading-[1.55] text-muted opacity-0"
        >
          {t('welcome.liftoff.description')}
          {latestAgentRequest?.model ? (
            <>
              {' '}
              {t('welcome.liftoff.routedTo', { model: latestAgentRequest.model })}
              {latestAgentRequest.duration_ms ? (
                <> {t('welcome.liftoff.in', { ms: latestAgentRequest.duration_ms })}</>
              ) : null}
              .
            </>
          ) : null}
        </p>
      </div>

      {/* Exit cluster: reading ends top-left, the scene resolves bottom-right —
          status caption over the one action, at the Z-pattern terminus. */}
      <div className="absolute bottom-[clamp(20px,4vh,48px)] right-[clamp(22px,4vw,64px)] z-[8] flex flex-col items-end gap-2.5">
        <span
          ref={status}
          className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted opacity-0"
          aria-hidden="true"
        >
          {t('welcome.liftoff.live', { name: harnessSlug || t('welcome.liftoff.agent') })}
        </span>
        <div ref={action} className="opacity-0">
          <Button size="lg" onClick={onLeave}>
            {t('welcome.liftoff.goToDashboard')}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}
/* v8 ignore stop */
