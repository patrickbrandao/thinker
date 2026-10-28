import {
  type AgentCategory,
  type AgentPlatform,
  AGENT_CATEGORIES,
  PLATFORMS_BY_CATEGORY,
  PLATFORM_ICONS,
} from 'thinker-shared';
import { categoryLabel, platformLabel } from '../services/agent-type-labels.js';
import { cx } from './ui.js';

interface Props {
  category: AgentCategory | null;
  platform: AgentPlatform | null;
  onCategoryChange: (c: AgentCategory) => void;
  onPlatformChange: (p: AgentPlatform) => void;
  disabled?: boolean;
  inline?: boolean;
}

const iconFor = (plat: AgentPlatform, cat: AgentCategory): string | undefined => {
  if (plat === 'other') return cat === 'personal' ? '/icons/other-agent.svg' : '/icons/other.svg';
  return PLATFORM_ICONS[plat];
};

/**
 * Harness type picker: one column per category, one option per platform.
 * Inline by default; AgentTypeSelect renders it as a floating dropdown.
 * The `agent-type-select__*` classes are stable test hooks.
 */
export default function AgentTypeGrid(props: Props) {
  const inline = props.inline !== false;
  const handleSelect = (cat: AgentCategory, plat: AgentPlatform) => {
    props.onCategoryChange(cat);
    props.onPlatformChange(plat);
  };

  return (
    <div
      className={cx(
        'agent-type-select__dropdown rounded-surface border border-line bg-elev p-2',
        inline
          ? 'agent-type-select__dropdown--inline'
          : 'absolute left-0 top-full z-20 mt-1 w-[min(640px,calc(100vw-32px))]',
      )}
      style={inline ? undefined : { boxShadow: 'var(--shadow-float)' }}
      role="listbox"
    >
      <div className="agent-type-select__groups grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[...AGENT_CATEGORIES].map((cat) => (
          <div key={cat} className="agent-type-select__column flex min-w-0 flex-col gap-0.5">
            <div
              className="agent-type-select__group-label eyebrow px-2 pb-1 pt-1"
              role="presentation"
            >
              {categoryLabel(cat)}
            </div>
            {[...PLATFORMS_BY_CATEGORY[cat]].map((plat) => {
              const isSelected = props.category === cat && props.platform === plat;
              const icon = iconFor(plat, cat);
              return (
                <button
                  key={plat}
                  className={cx(
                    'agent-type-select__option flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm text-dim hover:bg-s2 disabled:cursor-not-allowed disabled:opacity-50',
                    isSelected && 'agent-type-select__option--selected bg-accent-tint text-ink',
                  )}
                  onClick={() => handleSelect(cat, plat)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={props.disabled}
                >
                  {icon ? (
                    <img
                      src={icon}
                      alt=""
                      width="18"
                      height="18"
                      className="agent-type-select__option-icon shrink-0"
                    />
                  ) : null}
                  <span className="truncate">{platformLabel(plat)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
