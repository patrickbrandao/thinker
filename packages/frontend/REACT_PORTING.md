# Porting the dashboard from SolidJS to React (temporary guide)

This file guides the migration and is deleted when it ends. The decision is in
`docs/adr/0007-console-react.md`.

## Stack

- React 19, react-router 7 (`react-router`, declarative `<Routes>`), Vite 8.
- Tailwind 4 (`@tailwindcss/vite`) on the tokens in `src/styles-next/tokens.css`.
- Icons: `lucide-react`. Flow: `@xyflow/react` (only `components/flow/`).
- Tests: Vitest + `@testing-library/react` (+ `@testing-library/user-event` if
  useful). **No jest-dom**: assert with `getAttribute`, `textContent`,
  `toBeTruthy()`, `toBeNull()`, like the existing tests.

## What already exists (do not rewrite)

- `src/lib/signal.ts`: `signal(initial)` → call to read, `.set()` to write,
  `useSignal(sig)` in components. Global stores (`me`, `toasts`, SSE pings
  `messagePing`/`analyticsPing`/`agentPing`/`routingPing`, `locale`,
  `passwordChangeRequired`, `agentDisplayNameSignal`, `agentPlatformSignal`,
  `connectionBreadcrumbSignal`) are signals now.
- `src/lib/use-resource.ts`: `useResource(fetcher, deps, { enabled })` →
  `{ data, error, loading, reload, setData }`. Replaces `createResource`
  (`refetch` → `reload`, `mutate` → `setData`). To refetch on an SSE ping:
  `const ping = useSignal(routingPing); useResource(fn, [agentName, ping])`.
- `src/components/ui.tsx`: `Button`, `ButtonLink`, `IconButton`, `Panel`,
  `Field`, `Badge`, `Status`, `Tabs`, `Menu`/`MenuItem`/`MenuSeparator`/
  `MenuHeading`, `Modal`, `EmptyState`, `Skel`, `Kbd`, `Avatar`, `Switch`,
  `useClickOutside`, `cx`. Use them instead of hand-made markup.
- CSS classes (`src/styles-next/base.css`, `shell.css`): `.btn` (`.btn-ghost`,
  `.btn-quiet`, `.btn-danger`, `.btn-sm`), `.icon-btn`, `.field`, `.label`,
  `.hint`, `.check`, `.segmented`, `.panel` (`.panel-head`, `.panel-body`),
  `.card`, `.well`, `.badge` (`.is-ok`…), `.status`, `.kbd`, `.table-wrap` +
  `table.data` (`.num`, `.row-title`, `.row-sub`, `.row-actions`), `.empty`,
  `.skel`, `.spinner`, `.eyebrow`, `.link-action`, `.switch`, `pre.code`,
  `.page` (`.wide`, `.narrow`), `.page-head` (+ `.sub`), `.page-actions`,
  `.search-bar`, `.tabs`/`.tab`, `.stat-tiles`/`.stat-tile`, `.card-grid`,
  `.kv`, `.menu`, `.overlay`, `.modal` (`.modal-head`, `.modal-body`,
  `.actions`), `.drawer` (`.dh`, `.db`, `.sec`), `.notice` (`.is-warn`,
  `.is-danger`, `.is-info`), `.form-error`, `.form-notice`, `.gate`.
- Tailwind utilities on tokens: `bg-bg`, `bg-elev`, `bg-sunken`, `bg-s2…s4`,
  `border-line`, `border-line-strong`, `text-ink` (titles), `text-dim` (body),
  `text-muted` (labels), `text-faint` (hints), `text-accent`, `bg-accent-tint`,
  `text-ok`/`text-warn`/`text-danger`/`text-info` and `*-tint` backgrounds,
  `rounded-control`, `rounded-surface`, `rounded-node`, `font-mono`.
- Shell: `App.tsx`, `components/shell/*`, guards (`AuthGuard`, `GuestGuard`,
  `MeGate`, `AgentGuard`, `RootRedirect`), `ToastContainer`, `layouts/AuthLayout`,
  router in `index.tsx`. Converted services: `session-store`, `toast-store`,
  `sse`, `org-context`, `routing` (`useAgentName()` now returns `string | null`),
  `pagination` (`useClientPagination`), `cursor-pagination`
  (`useCursorPagination`), `use-overview-range`, `use-focus-trap`
  (`useFocusTrap(open, ref)`), `lazy-reload`, `right-sidebar`,
  `agent-display-name`, `agent-platform-store`, `connection-breadcrumb-store`,
  `auth-client` (`better-auth/react`: `authClient.useSession()` returns
  `{ data, isPending }` directly, not an accessor).
- i18n: `t(key, args)` is a plain function (the app remounts on language
  change). Plural entries take positional args: `t('x.count', n)`. Keys are
  typed; `tMaybe(key)` for runtime keys. Add new strings to **both**
  `locales/en/*.ts` and `locales/pt-BR/*.ts`; `npm run check:i18n` must pass.

## Rules

1. **Same behavior, same tests.** Port each Solid component to React keeping
   its props contract (names and meaning), its behavior and its texts. Port
   every test in your area to React Testing Library, keeping each case and
   its intent; adapt only the mechanics (render, events, async waits). Do not
   delete a test case unless the behavior moved to the shell (say which).
2. **Restyle with the tokens.** Drop the old CSS imports (`../styles/*.css`)
   and classes; use `ui.tsx`, the classes above and Tailwind utilities. No hex
   colors, no `dark:` variants for colors, no inline color styles. Fixed
   surfaces have no shadow. Keep layouts clean and dense like an admin
   console: `.page` > `.page-head` (h1 + `.sub` + `.page-actions`) > panels,
   tables (`table.data` in `.table-wrap`), forms (`Field` + `.field`).
   Check light and dark (both come from the tokens) and phone width.
3. **Solid → React map.** `createSignal` → `useState`; `createMemo` → plain
   expression or `useMemo`; `createEffect` → `useEffect` with deps;
   `onMount` → `useEffect(…, [])`; `onCleanup` → effect cleanup;
   `createResource` → `useResource`; `<Show when fallback>` → ternary;
   `<For each>` → `.map` with `key`; `<Switch>/<Match>` → conditionals;
   `class` → `className`; `classList` → `cx()`; `style="a: b"` → style object;
   `onInput` → `onChange`; `innerHTML` → `dangerouslySetInnerHTML` (only where
   the Solid code already did it, keep its sanitizing); `ref={el}` → `useRef`;
   `props.children` stays; `ParentComponent` → `{ children }: { children: ReactNode }`;
   `@solidjs/router` `A href` → `Link to`, `useNavigate()(path)` same,
   `useParams`/`useSearchParams` from `react-router` (search params are a
   `URLSearchParams`: `searchParams.get('x')`, `setSearchParams(prev => …)`);
   `<Navigate href>` → `<Navigate to replace>`; `@solidjs/meta` `<Title>` →
   React 19 `<title>` element; `<Portal>` → `createPortal`. Nested route
   layouts render `<Outlet />` instead of `props.children`.
4. **Ownership.** Touch only the files in your area (listed in your brief). If
   you need a change in a shared file you do not own, keep a local workaround
   and report it; do not edit it. Shared files already in React: everything
   in "What already exists".
5. **Checks.** Run `npx vitest run <your test paths>` and `npx tsc6 -p
   tsconfig.json --noEmit 2>&1 | grep -E '<your paths regex>'` (the full
   typecheck fails until every area is ported; only your files must be clean).
   Run `npm run check:i18n` if you touched strings. Run `npx prettier --write`
   on your files.
6. **Commit** on your worktree branch with Conventional Commits
   (`refactor(frontend): port <area> to React`), ending the message with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
