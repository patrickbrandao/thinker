import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { type AgentCategory, type AgentPlatform, PLATFORM_ICONS } from 'thinker-shared';
import { platformLabel } from '../services/agent-type-labels.js';
import { t } from '../i18n/index.js';
import AgentTypeGrid from './AgentTypeGrid.js';
import { cx } from './ui.js';

interface Props {
  category: AgentCategory | null;
  platform: AgentPlatform | null;
  onCategoryChange: (c: AgentCategory) => void;
  onPlatformChange: (p: AgentPlatform) => void;
  disabled?: boolean;
}

const iconFor = (plat: AgentPlatform, cat: AgentCategory): string | undefined => {
  if (plat === 'other') return cat === 'personal' ? '/icons/other-agent.svg' : '/icons/other.svg';
  return PLATFORM_ICONS[plat];
};

/** Trigger button showing the chosen harness type; opens AgentTypeGrid as a dropdown. */
export default function AgentTypeSelect(props: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedIcon =
    !props.platform || !props.category
      ? '/icons/other.svg'
      : iconFor(props.platform, props.category);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const label = props.platform ? platformLabel(props.platform) : t('harnesses.typeSelect.select');

  return (
    <div className="agent-type-select relative" ref={ref}>
      <button
        className={cx(
          'agent-type-select__trigger field flex items-center gap-2 text-left',
          open && 'agent-type-select__trigger--open',
        )}
        onClick={() => setOpen(!open)}
        type="button"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('harnesses.typeSelect.aria', { type: label })}
      >
        {selectedIcon ? (
          <img
            src={selectedIcon}
            alt=""
            width="18"
            height="18"
            className="agent-type-select__trigger-icon shrink-0"
          />
        ) : null}
        <span className="agent-type-select__trigger-label flex-1 truncate">{label}</span>
        <ChevronDown
          className="agent-type-select__caret size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
      </button>
      {open ? (
        <AgentTypeGrid
          inline={false}
          category={props.category}
          platform={props.platform}
          onCategoryChange={props.onCategoryChange}
          onPlatformChange={(platform) => {
            props.onPlatformChange(platform);
            setOpen(false);
          }}
          disabled={props.disabled}
        />
      ) : null}
    </div>
  );
}
