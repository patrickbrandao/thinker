import type { ReactNode } from 'react';
import { ChevronDown, Cog, GlobeLock, Layers, Waypoints } from 'lucide-react';
import { t } from '../../i18n/index.js';
import { cx, Menu, MenuItem } from '../ui.js';

export interface OutboundOption {
  /** `inherit`, `global`, `direct` or `profile:<id>`. */
  value: string;
  label: string;
}

/** Icon of an outbound option: cog (global default), globe-lock (direct), waypoints (profile). */
export function outboundIcon(value: string): ReactNode {
  if (value === 'direct') return <GlobeLock aria-hidden="true" />;
  if (value.startsWith('profile:')) return <Waypoints aria-hidden="true" />;
  if (value === 'inherit-provider') return <Layers aria-hidden="true" />;
  return <Cog aria-hidden="true" />;
}

/** Options for the global default, direct and each profile. */
export function baseOutboundOptions(
  profiles: Array<{ id: string; name: string }>,
): OutboundOption[] {
  return [
    { value: 'global', label: t('proxies.assignment.global') },
    { value: 'direct', label: t('proxies.assignment.direct') },
    ...profiles.map((p) => ({
      value: `profile:${p.id}`,
      label: t('proxies.assignment.profileNamed', { name: p.name }),
    })),
  ];
}

/**
 * Dropdown of outbound options with an icon per option (a native select
 * cannot show icons). `iconFor` maps an option value to its icon key.
 */
export default function OutboundSelect({
  value,
  options,
  onChange,
  disabled,
  label,
  iconFor = (v) => v,
  className,
}: {
  value: string;
  options: OutboundOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  iconFor?: (value: string) => string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Menu
      label={label}
      className="max-h-72 overflow-auto"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={label}
          disabled={disabled}
          className={cx(
            'field flex w-full min-w-[220px] items-center gap-2 text-left [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted',
            className,
          )}
        >
          {current ? outboundIcon(iconFor(current.value)) : null}
          <span className="min-w-0 flex-1 truncate">{current?.label ?? '—'}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      )}
    >
      {options.map((option) => (
        <MenuItem
          key={option.value}
          icon={outboundIcon(iconFor(option.value))}
          active={option.value === value}
          onSelect={() => {
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
