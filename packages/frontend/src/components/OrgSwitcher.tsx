import { For, Show, createResource, createSignal, type Component } from 'solid-js';
import { createOrganization, listOrganizations } from '../services/api/organizations.js';
import { roleLabel } from '../services/permissions.js';
import { isInstanceAdmin, me, switchOrganization } from '../services/session-store.js';
import '../styles/organization.css';
import { t } from '../i18n/index.js';

/**
 * Active-organization picker at the top of the sidebar. Switching stores the
 * choice, saves it server-side and reloads the dashboard in the new scope.
 * Instance admins also get "New organization".
 */
const OrgSwitcher: Component = () => {
  const [orgs] = createResource(async () => (await listOrganizations()).organizations);
  const [createOpen, setCreateOpen] = createSignal(false);
  const [name, setName] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const activeId = () => me()?.organization?.id ?? '';
  const activeRole = () => me()?.organization?.role;
  const list = () => {
    const loaded = orgs() ?? [];
    const current = me()?.organization;
    // Keep the active one selectable even before the list loads.
    if (current && !loaded.some((o) => o.id === current.id)) return [current, ...loaded];
    return loaded;
  };

  const handleChange = (id: string) => {
    if (id && id !== activeId()) void switchOrganization(id);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setName('');
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const trimmed = name().trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const org = await createOrganization(trimmed);
      closeCreate();
      await switchOrganization(org.id);
    } catch {
      // fetchMutate already toasted the backend message
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class="org-switcher">
      <label class="org-switcher__label" for="org-switcher-select">
        {t('org.switcher.label')}
      </label>
      <div class="org-switcher__row">
        <Show
          when={list().length > 1}
          fallback={<span class="org-switcher__name">{me()?.organization?.name ?? ''}</span>}
        >
          <select
            id="org-switcher-select"
            class="org-switcher__select"
            value={activeId()}
            onChange={(e) => handleChange(e.currentTarget.value)}
          >
            <For each={list()}>{(org) => <option value={org.id}>{org.name}</option>}</For>
          </select>
        </Show>
        <Show when={isInstanceAdmin()}>
          <button
            type="button"
            class="sidebar__section-add"
            title={t('org.switcher.newOrg')}
            aria-label={t('org.switcher.newOrg')}
            onClick={() => setCreateOpen(true)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M19 12.998h-6v6h-2v-6H5v-2h6v-6h2v6h6z" />
            </svg>
          </button>
        </Show>
      </div>
      <Show when={activeRole()}>
        {(role) => (
          <span class="org-switcher__role">{t('org.yourRole', { role: roleLabel(role()) })}</span>
        )}
      </Show>

      <Show when={createOpen()}>
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCreate();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeCreate();
          }}
        >
          <form
            class="modal-card"
            style="max-width: 420px;"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-org-title"
            onSubmit={handleCreate}
          >
            <h3
              id="new-org-title"
              style="margin: 0 0 var(--gap-md); font-size: var(--font-size-lg);"
            >
              {t('org.switcher.newOrg')}
            </h3>
            <label class="org-form__field" style="margin-bottom: var(--gap-lg);">
              {t('common.name')}
              <input
                ref={(el) => setTimeout(() => el.focus(), 50)}
                class="auth-form__input"
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                required
              />
            </label>
            <div style="display: flex; justify-content: flex-end; gap: var(--gap-sm);">
              <button type="button" class="btn btn--outline btn--sm" onClick={closeCreate}>
                {t('common.cancel')}
              </button>
              <button type="submit" class="btn btn--primary btn--sm" disabled={creating()}>
                {t('common.create')}
              </button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  );
};

export default OrgSwitcher;
