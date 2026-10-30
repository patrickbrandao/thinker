import {
  type AgentCategory,
  type AgentPlatform,
  AGENT_CATEGORIES,
  PLATFORMS_BY_CATEGORY,
  PLATFORM_ICONS,
} from 'thinker-shared';
import { categoryLabel, platformLabel } from '../services/agent-type-labels.js';
import { themedIcon, useDarkTheme } from './setup-ui.js';
import { cx } from './ui.js';

interface Props {
  category: AgentCategory | null;
  platform: AgentPlatform | null;
  onCategoryChange: (c: AgentCategory) => void;
  onPlatformChange: (p: AgentPlatform) => void;
  disabled?: boolean;
  inline?: boolean;
  /** Option icon size in px (18 by default). */
  iconSize?: number;
}

const iconFor = (plat: AgentPlatform, cat: AgentCategory): string | undefined => {
  if (plat === 'other') return cat === 'personal' ? '/icons/other-agent.svg' : '/icons/other.svg';
  return PLATFORM_ICONS[plat];
};

/**
 * Harness type picker. Inline (the default) it is one borderless row per
 * category: the category title, then its platforms left to right, the chosen
 * one ringed in liquid metal. AgentTypeSelect renders it as a dropdown with
 * one column per category. The `agent-type-select__*` classes are stable test
 * hooks.
 */
export default function AgentTypeGrid(props: Props) {
  const inline = props.inline !== false;
  const iconSize = props.iconSize ?? 18;
  const dark = useDarkTheme();
  const handleSelect = (cat: AgentCategory, plat: AgentPlatform) => {
    props.onCategoryChange(cat);
    props.onPlatformChange(plat);
  };

  return (
    <div
      className={cx(
        'agent-type-select__dropdown',
        inline
          ? 'agent-type-select__dropdown--inline'
          : 'absolute left-0 top-full z-20 mt-1 w-[min(640px,calc(100vw-32px))] rounded-surface border border-line bg-elev p-2',
      )}
      style={inline ? undefined : { boxShadow: 'var(--shadow-float)' }}
      role="listbox"
    >
      <div
        className={cx(
          'agent-type-select__groups',
          inline ? 'flex flex-col gap-4' : 'grid grid-cols-2 gap-2 sm:grid-cols-4',
        )}
      >
        {[...AGENT_CATEGORIES].map((cat) => (
          <div
            key={cat}
            className={cx(
              'agent-type-select__column flex min-w-0 flex-col',
              inline ? 'gap-2' : 'gap-0.5',
            )}
          >
            <div
              className={cx(
                'agent-type-select__group-label',
                inline ? 'text-sm font-medium text-ink' : 'eyebrow px-2 pb-1 pt-1',
              )}
              role="presentation"
            >
              {categoryLabel(cat)}
            </div>
            <div className={inline ? 'flex flex-wrap gap-2' : 'contents'}>
              {[...PLATFORMS_BY_CATEGORY[cat]].map((plat) => {
                const isSelected = props.category === cat && props.platform === plat;
                const base = iconFor(plat, cat);
                const icon = base ? themedIcon(base, dark) : null;
                return (
                  <button
                    key={plat}
                    className={cx(
                      'agent-type-select__option flex items-center gap-2 rounded-control text-left text-sm text-dim hover:bg-s2 disabled:cursor-not-allowed disabled:opacity-50',
                      inline ? 'px-3 py-2' : 'w-full px-2 py-1.5',
                      isSelected && 'agent-type-select__option--selected text-ink',
                      isSelected && (inline ? 'liquid-metal' : 'bg-accent-tint'),
                    )}
                    onClick={() => handleSelect(cat, plat)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={props.disabled}
                  >
                    {icon ? (
                      <img
                        src={icon.src}
                        alt=""
                        width={iconSize}
                        height={iconSize}
                        className={cx(
                          'agent-type-select__option-icon shrink-0 object-contain',
                          icon.className,
                        )}
                      />
                    ) : null}
                    <span className="truncate">{platformLabel(plat)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
