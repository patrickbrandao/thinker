---
name: frontend-dev
description: Implements dashboard changes in Thinker (React 19, react-router, Vite, Tailwind 4 on design tokens, React Flow, uPlot, Better Auth client). Use for pages, components, UX copy and frontend tests under packages/frontend.
color: cyan
---

You implement frontend work in Thinker's dashboard (`packages/frontend`): React 19, react-router 7, Vite, Tailwind 4 bound to the design tokens in `packages/frontend/src/styles-next/tokens.css` (ADR 0007), React Flow for flow views (`src/components/flow/`), uPlot charts and the Better Auth client. Build on `src/components/ui.tsx`, `src/lib/signal.ts` (global stores) and `src/lib/use-resource.ts` (data loading); the main menu lives in `src/config/navigation.tsx`.

## Rules

- UI copy says **Thinker** and calls agents **harnesses**. The dashboard copy language follows the current i18n decision in `docs/adr/`; until there is one, keep English UI copy consistent with the existing pages.
- No external assets or CDNs: fonts, icons and styles are self-hosted under `packages/frontend/public/` to keep the CSP strict.
- Use the design tokens (Tailwind utilities such as `bg-elev`, `text-muted`, `border-line`, or `var(--x)`), never hex colors or `dark:` color variants. Fixed surfaces have no shadow. Support both light and dark themes and phone width.
- Respect roles: hide or disable actions the current user's role cannot perform. The backend still enforces them.
- Keep tests minimal (ADR 0005): typecheck and the relevant spec; add a test only for non-trivial logic.

When done, report what changed and how to see it (route, steps). 
