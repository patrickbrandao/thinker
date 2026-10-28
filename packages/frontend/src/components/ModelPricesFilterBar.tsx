import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { getModelDisplayName } from '../services/model-display.js';
import { resolveProviderId } from '../services/routing-utils.js';
import { providerIcon } from './ProviderIcon.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

interface ModelPricesFilterBarProps {
  allModels: string[];
  allProviders: string[];
  selectedModels: Set<string>;
  selectedProviders: Set<string>;
  onAddModel: (model: string) => void;
  onRemoveModel: (model: string) => void;
  onAddProvider: (provider: string) => void;
  onRemoveProvider: (provider: string) => void;
  onClearFilters: () => void;
  totalCount: number;
  filteredCount: number;
}

interface Suggestion {
  type: 'Provider' | 'Model';
  value: string;
}

type Tag = Suggestion;

function FilterProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const pid = resolveProviderId(provider);
  const icon = pid ? providerIcon(pid, size) : null;
  if (!icon) {
    // Generic chip glyph for providers without a logo.
    return (
      <svg
        className="model-filter__provider-icon shrink-0 text-muted"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <span className="model-filter__provider-icon inline-flex shrink-0" aria-hidden="true">
      {icon}
    </span>
  );
}

/**
 * Search box that turns provider and model suggestions into removable filter
 * tags. The `model-filter__*` classes are stable hooks; the look comes from
 * tokens and the `.field`/`.menu` primitives.
 */
export default function ModelPricesFilterBar(props: ModelPricesFilterBarProps) {
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasActiveFilters = props.selectedModels.size > 0 || props.selectedProviders.size > 0;

  const activeTags: Tag[] = useMemo(
    () => [
      ...[...props.selectedProviders].map((value) => ({ type: 'Provider' as const, value })),
      ...[...props.selectedModels].map((value) => ({ type: 'Model' as const, value })),
    ],
    [props.selectedProviders, props.selectedModels],
  );

  const q = query.toLowerCase().trim();
  const matchingProviders =
    q.length < 2
      ? []
      : props.allProviders
          .filter((p) => !props.selectedProviders.has(p) && p.toLowerCase().includes(q))
          .slice(0, 5);
  const matchingModels =
    q.length < 2
      ? []
      : props.allModels
          .filter((m) => !props.selectedModels.has(m) && m.toLowerCase().includes(q))
          .slice(0, 5);
  const flatSuggestions: Suggestion[] = [
    ...matchingProviders.map((value) => ({ type: 'Provider' as const, value })),
    ...matchingModels.map((value) => ({ type: 'Model' as const, value })),
  ];

  const selectSuggestion = (suggestion: Suggestion) => {
    if (suggestion.type === 'Provider') props.onAddProvider(suggestion.value);
    else props.onAddModel(suggestion.value);
    setQuery('');
    setDropdownOpen(false);
    setHighlightIndex(-1);
    inputRef.current?.focus();
  };

  const removeTag = (tag: Tag) => {
    if (tag.type === 'Provider') props.onRemoveProvider(tag.value);
    else props.onRemoveModel(tag.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!dropdownOpen && query.trim().length >= 2) setDropdownOpen(true);
      setHighlightIndex((i) => Math.min(i + 1, flatSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < flatSuggestions.length) {
        selectSuggestion(flatSuggestions[highlightIndex]!);
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
      setHighlightIndex(-1);
    } else if (e.key === 'Backspace' && query === '') {
      const last = activeTags[activeTags.length - 1];
      if (last) removeTag(last);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setHighlightIndex(-1);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const renderOption = (s: Suggestion) => {
    const idx = flatSuggestions.findIndex((f) => f.type === s.type && f.value === s.value);
    const highlighted = highlightIndex === idx;
    return (
      <button
        key={`${s.type}:${s.value}`}
        type="button"
        role="option"
        aria-selected={highlighted}
        className={cx(
          'model-filter__dropdown-item menu-item justify-between',
          highlighted && 'model-filter__dropdown-item--highlighted bg-s2 text-ink',
        )}
        onClick={() => selectSuggestion(s)}
        onMouseEnter={() => setHighlightIndex(idx)}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {s.type === 'Provider' ? (
            <>
              <FilterProviderIcon provider={s.value} size={16} />
              {s.value}
            </>
          ) : (
            getModelDisplayName(s.value)
          )}
        </span>
        <span className="text-[11px] text-faint">
          {s.type === 'Provider' ? t('models.filter.provider') : t('models.filter.model')}
        </span>
      </button>
    );
  };

  return (
    <div className="model-filter border-b border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div ref={comboboxRef} className="model-filter__combobox relative w-full sm:w-80">
          <div className="search-bar">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="model-filter__search field !w-full"
              placeholder={t('models.searchPlaceholder')}
              value={query}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setQuery(value);
                setHighlightIndex(-1);
                setDropdownOpen(value.trim().length >= 2);
              }}
              onKeyDown={handleKeyDown}
              role="combobox"
              aria-expanded={dropdownOpen}
              aria-autocomplete="list"
              aria-label={t('models.searchLabel')}
            />
          </div>
          {dropdownOpen && flatSuggestions.length > 0 ? (
            <div
              className="model-filter__dropdown menu left-0 right-0 top-full mt-1"
              role="listbox"
            >
              {matchingProviders.length > 0 ? (
                <div className="model-filter__dropdown-group">
                  <div className="model-filter__dropdown-label menu-heading">
                    {t('models.filter.providers')}
                  </div>
                  {matchingProviders.map((value) => renderOption({ type: 'Provider', value }))}
                </div>
              ) : null}
              {matchingModels.length > 0 ? (
                <div className="model-filter__dropdown-group">
                  <div className="model-filter__dropdown-label menu-heading">
                    {t('models.filter.models')}
                  </div>
                  {matchingModels.map((value) => renderOption({ type: 'Model', value }))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="model-filter__summary flex items-center gap-3 text-xs text-muted">
          {hasActiveFilters ? (
            <>
              <span>
                {t('models.filter.filteredCount', {
                  filtered: props.filteredCount,
                  total: props.totalCount,
                })}
              </span>
              <button
                type="button"
                className="model-filter__clear-all link-action text-xs"
                onClick={() => {
                  props.onClearFilters();
                  setQuery('');
                  setDropdownOpen(false);
                }}
              >
                {t('models.filter.clearFilters')}
              </button>
            </>
          ) : (
            <span>{t('models.filter.count', { count: props.totalCount })}</span>
          )}
        </div>
      </div>
      {activeTags.length > 0 ? (
        <div className="model-filter__tags mt-3 flex flex-wrap gap-2">
          {activeTags.map((tag) => (
            <span
              key={`${tag.type}:${tag.value}`}
              className={cx(
                'model-filter__tag inline-flex h-7 items-center gap-1.5 rounded-control border border-line bg-s2 pl-2 pr-1 text-xs text-dim',
                tag.type === 'Provider' && 'model-filter__tag--provider',
              )}
            >
              {tag.type === 'Provider' ? (
                <FilterProviderIcon provider={tag.value} size={16} />
              ) : (
                <span className="text-faint">{t('models.filter.modelTag')}</span>
              )}
              <span className="font-medium text-ink">
                {tag.type === 'Model' ? getModelDisplayName(tag.value) : tag.value}
              </span>
              <button
                type="button"
                className="model-filter__tag-remove inline-flex h-5 w-5 items-center justify-center rounded-control text-muted hover:bg-s3 hover:text-ink"
                onClick={() => removeTag(tag)}
                aria-label={
                  tag.type === 'Provider'
                    ? t('models.filter.removeProvider', { value: tag.value })
                    : t('models.filter.removeModel', { value: tag.value })
                }
              >
                <X width={12} height={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
