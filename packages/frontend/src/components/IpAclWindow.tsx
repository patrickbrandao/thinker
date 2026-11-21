import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { EthernetPort, Trash2 } from 'lucide-react';
import ErrorState from './ErrorState.js';
import IpPrefixEntriesEditor, {
  entriesError,
  filledRows,
  type EntryRow,
} from './IpPrefixEntriesEditor.js';
import { Button, Field, FloatingWindow, Skel, Tabs } from './ui.js';
import {
  createIpPrefixList,
  deleteIpPrefixList,
  getIpPrefixList,
  updateIpPrefixList,
  type IpAclKeyRef,
  type IpPrefixListView,
  type IpPrefixListWrite,
} from '../services/api/ip-prefix-lists.js';
import { agentPath } from '../services/routing.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

type Tab = 'general' | 'entries' | 'keys' | 'delete';

interface Form {
  name: string;
  description: string;
  rows: EntryRow[];
}

function formOf(list: IpPrefixListView | null): Form {
  const rows = (list?.entries ?? []).map((e) => ({ prefix: e.prefix, label: e.label ?? '' }));
  return {
    name: list?.name ?? '',
    description: list?.description ?? '',
    rows: rows.length ? rows : [{ prefix: '', label: '' }],
  };
}

function payloadOf(form: Form): IpPrefixListWrite {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    entries: filledRows(form.rows).map((r) => ({
      prefix: r.prefix.trim(),
      label: r.label.trim() || null,
    })),
  };
}

/**
 * Floating editor of one IP ACL ('new' creates one). Tabs: General (name and
 * description), the IP addresses, the API keys that use it, and Delete, which
 * unlinks every key before deleting.
 */
export default function IpAclWindow({
  listId,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** The list to edit, 'new' to create, null when closed. */
  listId: string | null;
  onClose: () => void;
  onSaved: (list: IpPrefixListView) => void;
  onDeleted: (id: string) => void;
}) {
  const isNew = listId === 'new';
  const detail = useResource(() => getIpPrefixList(listId!), [listId], {
    enabled: !!listId && !isNew,
  });
  const list = isNew ? null : (detail.data ?? null);
  const [tab, setTab] = useState<Tab>('general');
  const [form, setForm] = useState<Form>(() => formOf(null));
  const [errors, setErrors] = useState<{ name?: string; entries?: string; server?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => setTab('general'), [listId]);
  useEffect(() => {
    setForm(formOf(list));
    setErrors({});
  }, [list, listId]);

  const save = async () => {
    const found: typeof errors = {};
    if (!form.name.trim()) found.name = t('ipLists.form.errors.name');
    const entryErr = entriesError(form.rows);
    if (entryErr) found.entries = entryErr;
    setErrors(found);
    // Show the tab holding the first error.
    if (found.name) setTab('general');
    else if (found.entries) setTab('entries');
    if (found.name || found.entries) return;
    setSaving(true);
    try {
      const body = payloadOf(form);
      const opts = { silent: true };
      const saved = list
        ? await updateIpPrefixList(list.id, body, opts)
        : await createIpPrefixList(body, opts);
      toast.success(list ? t('ipLists.toast.updated') : t('ipLists.toast.created'));
      onSaved(saved);
    } catch (err) {
      // 400 (bad entry) and 409 (duplicate name) messages go next to the form.
      setErrors({ server: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const title = list
    ? t('ipLists.form.editTitle', { name: list.name })
    : isNew
      ? t('ipLists.form.createTitle')
      : t('ipLists.form.title');

  const footer =
    (tab === 'general' || tab === 'entries') && (isNew || list) ? (
      <>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" busy={saving} onClick={() => void save()}>
          {list ? t('common.saveChanges') : t('ipLists.form.createSubmit')}
        </Button>
      </>
    ) : undefined;

  return (
    <FloatingWindow
      open={!!listId}
      title={title}
      icon={<EthernetPort aria-hidden="true" />}
      onClose={onClose}
      className="floating-window--wide"
      footer={footer}
    >
      {!isNew && detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
      ) : !isNew && !list ? (
        <Skel width="100%" height={240} />
      ) : (
        <div className="flex flex-col gap-4">
          <Tabs<Tab>
            label={title}
            value={tab}
            onChange={setTab}
            items={[
              { key: 'general', label: t('ipLists.tabs.general') },
              {
                key: 'entries',
                label: t('ipLists.tabs.entries'),
                count: filledRows(form.rows).length,
              },
              ...(list
                ? [
                    {
                      key: 'keys' as const,
                      label: t('ipLists.tabs.keys'),
                      count: list.keys.length,
                    },
                    { key: 'delete' as const, label: t('ipLists.tabs.delete') },
                  ]
                : []),
            ]}
          />
          {tab === 'general' ? (
            <GeneralTab form={form} setForm={setForm} errors={errors} />
          ) : tab === 'entries' ? (
            <EntriesTab form={form} setForm={setForm} errors={errors} />
          ) : !list ? null : tab === 'keys' ? (
            <KeysTab keys={list.keys} />
          ) : (
            <DeleteTab list={list} onDeleted={() => onDeleted(list.id)} />
          )}
        </div>
      )}
    </FloatingWindow>
  );
}

function GeneralTab({
  form,
  setForm,
  errors,
}: {
  form: Form;
  setForm: (update: (f: Form) => Form) => void;
  errors: { name?: string; entries?: string; server?: string };
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('ipLists.form.name')} htmlFor="ip-list-name" error={errors.name}>
        <input
          id="ip-list-name"
          className="field"
          maxLength={100}
          value={form.name}
          autoFocus
          onChange={(e) => {
            const name = e.currentTarget.value;
            setForm((f) => ({ ...f, name }));
          }}
        />
      </Field>
      <Field label={t('ipLists.form.description')} htmlFor="ip-list-description">
        <textarea
          id="ip-list-description"
          className="field"
          rows={2}
          maxLength={500}
          value={form.description}
          onChange={(e) => {
            const description = e.currentTarget.value;
            setForm((f) => ({ ...f, description }));
          }}
        />
      </Field>
      <ServerError message={errors.server} />
    </div>
  );
}

function EntriesTab({
  form,
  setForm,
  errors,
}: {
  form: Form;
  setForm: (update: (f: Form) => Form) => void;
  errors: { entries?: string; server?: string };
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="label">{t('ipLists.form.entries')}</span>
        <IpPrefixEntriesEditor
          rows={form.rows}
          onChange={(rows) => setForm((f) => ({ ...f, rows }))}
        />
        {errors.entries ? (
          <p className="hint text-danger" role="alert">
            {errors.entries}
          </p>
        ) : null}
      </div>
      <ServerError message={errors.server} />
    </div>
  );
}

/** Save errors from the server (bad entry, duplicate name), shown on both form tabs. */
function ServerError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="notice is-danger" role="alert">
      <span>{message}</span>
    </div>
  );
}

function KeysTab({ keys }: { keys: IpAclKeyRef[] }) {
  if (!keys.length) return <p className="m-0 text-sm text-muted">{t('ipLists.keys.none')}</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('ipLists.keys.harness')}</th>
            <th>{t('ipLists.keys.key')}</th>
            <th>{t('ipLists.keys.lists')}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>
                <Link to={agentPath(k.harness, '/keys')} className="text-ink hover:underline">
                  {k.harnessDisplayName || k.harness}
                </Link>
              </td>
              <td className="text-sm">{k.name}</td>
              <td className="text-sm text-dim">
                {k.listCount <= 1 ? t('ipLists.keys.onlyThis') : k.listCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeleteTab({ list, onDeleted }: { list: IpPrefixListView; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const inUse = list.keys.length > 0;
  const losing = list.keys.filter((k) => k.listCount <= 1);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteIpPrefixList(list.id, { silent: true }, inUse);
      toast.success(t('ipLists.toast.deleted'));
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold text-danger">
        {t('ipLists.delete.title', { name: list.name })}
      </h3>
      <p className="m-0 text-sm text-dim">
        {inUse
          ? t('ipLists.delete.inUse', { count: list.keys.length })
          : t('ipLists.delete.unused')}
      </p>
      {losing.length ? (
        <div className="notice is-warn flex-col items-start" role="status">
          <span>{t('ipLists.delete.loseRestriction')}</span>
          <ul className="m-0 pl-5 text-sm">
            {losing.map((k) => (
              <li key={k.id}>
                {k.harnessDisplayName || k.harness} · {k.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <Button variant="danger" size="sm" busy={busy} onClick={() => void remove()}>
          <Trash2 aria-hidden="true" />
          {inUse ? t('ipLists.delete.buttonUnlink') : t('ipLists.delete.button')}
        </Button>
      </div>
    </div>
  );
}
