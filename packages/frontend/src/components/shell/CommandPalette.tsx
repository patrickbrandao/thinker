import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import {
  Bot,
  Box,
  Building2,
  KeyRound,
  Layers,
  LogOut,
  Moon,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  User,
} from 'lucide-react';
import { NAVIGATION, navLabel } from '../../config/navigation.js';
import {
  searchConsole,
  type SearchResult,
  type SearchResultType,
} from '../../services/api/console.js';
import { isInstanceAdmin } from '../../services/session-store.js';
import { toggleTheme } from '../../lib/theme.js';
import { useFocusTrap } from '../../services/use-focus-trap.js';
import { t } from '../../i18n/index.js';
import { Kbd } from '../ui.jsx';
import { signOut } from './UserMenu.jsx';

interface Command {
  id: string;
  group: string;
  label: string;
  sub?: string | null;
  icon: ReactNode;
  run: () => void;
}

const RESULT_ICONS: Record<SearchResultType, ReactNode> = {
  harness: <Bot />,
  connection: <Plug />,
  custom_provider: <KeyRound />,
  virtual_model: <Sparkles />,
  model: <Box />,
  member: <User />,
};

/** Lowercase, accent-free text for client-side matching of commands. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * ⌘K palette: jump to any page, run a few shell actions, and search the
 * organization's configuration (harnesses, connections, custom providers,
 * virtual models, models, members) by name or description.
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setActive(0);
    }
  }, [open]);

  // Debounced server search; an older answer never replaces a newer query.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchConsole(q)
        .then((res) => {
          if (!cancelled) setResults(res.results);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const pages: Command[] = NAVIGATION.flatMap((group) =>
      group.items.map((item) => {
        const Icon = item.icon;
        return {
          id: `nav:${item.key}`,
          group: t('shell.palette.goTo'),
          label: navLabel(item),
          icon: <Icon />,
          run: go(item.to),
        };
      }),
    );
    const account: Command[] = [
      {
        id: 'nav:account',
        group: t('shell.palette.goTo'),
        label: t('nav.accountPreferences'),
        icon: <Settings />,
        run: go('/account'),
      },
      {
        id: 'nav:org',
        group: t('shell.palette.goTo'),
        label: t('shell.user.organization'),
        icon: <Building2 />,
        run: go('/organization'),
      },
      {
        id: 'nav:cli',
        group: t('shell.palette.goTo'),
        label: 'CLI',
        icon: <Terminal />,
        run: go('/integrations/cli'),
      },
      {
        id: 'nav:mcp',
        group: t('shell.palette.goTo'),
        label: t('nav.mcpServer'),
        icon: <Layers />,
        run: go('/integrations/mcp'),
      },
      ...(isInstanceAdmin()
        ? [
            {
              id: 'nav:users',
              group: t('shell.palette.goTo'),
              label: t('nav.users'),
              icon: <ShieldCheck />,
              run: go('/admin/users'),
            },
          ]
        : []),
    ];
    const actions: Command[] = [
      {
        id: 'act:theme',
        group: t('shell.palette.actions'),
        label: t('shell.palette.toggleTheme'),
        icon: <Moon />,
        run: toggleTheme,
      },
      {
        id: 'act:logout',
        group: t('shell.palette.actions'),
        label: t('nav.logOut'),
        icon: <LogOut />,
        run: () => void signOut(),
      },
    ];
    return [...pages, ...account, ...actions];
  }, [navigate]);

  const visible = useMemo<Command[]>(() => {
    const q = fold(query.trim());
    const local = q ? commands.filter((c) => fold(c.label).includes(q)) : commands;
    const found: Command[] = results.map((r) => ({
      id: `res:${r.type}:${r.id}`,
      group: t(`shell.palette.types.${r.type}`),
      label: r.title,
      sub: r.subtitle,
      icon: RESULT_ICONS[r.type],
      run: () => navigate(r.href),
    }));
    return [...found, ...local];
  }, [commands, results, query, navigate]);

  useEffect(() => setActive(0), [query, results]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runAt = (index: number) => {
    const command = visible[index];
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runAt(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  let lastGroup = '';
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.palette.label')}
        onKeyDown={onKeyDown}
      >
        <div className="palette-input">
          <Search aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('shell.palette.placeholder')}
            aria-label={t('shell.palette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={visible[active] ? `palette-${active}` : undefined}
          />
          {searching ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            // i18n-ignore: key name
            <Kbd>Esc</Kbd>
          )}
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {visible.length === 0 ? (
            <div className="empty">
              <h3>{searching ? t('common.loading') : t('shell.palette.noResults')}</h3>
            </div>
          ) : (
            visible.map((command, index) => {
              const heading = command.group !== lastGroup ? command.group : null;
              lastGroup = command.group;
              return (
                <div key={command.id}>
                  {heading ? <div className="palette-group">{heading}</div> : null}
                  <button
                    type="button"
                    id={`palette-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    className="palette-item"
                    onMouseMove={() => setActive(index)}
                    onClick={() => runAt(index)}
                  >
                    {command.icon}
                    <span className="truncate">{command.label}</span>
                    {command.sub ? <span className="palette-sub">{command.sub}</span> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> {t('shell.palette.navigate')}
          </span>
          <span>
            <Kbd>↵</Kbd> {t('shell.palette.open')}
          </span>
          <span className="ml-auto">{t('shell.palette.hint')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
