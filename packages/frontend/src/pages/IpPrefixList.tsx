import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Trash2 } from 'lucide-react';
import ErrorState from '../components/ErrorState.js';
import IpPrefixEntriesEditor, {
  entriesError,
  filledRows,
  type EntryRow,
} from '../components/IpPrefixEntriesEditor.js';
import { Button, ConfirmDialog, Field, Panel, Skel } from '../components/ui.js';
import { ApiError } from '../services/api/core.js';
import {
  createIpPrefixList,
  deleteIpPrefixList,
  getIpPrefixList,
  ipPrefixListPath,
  updateIpPrefixList,
  type HarnessRef,
  type IpPrefixListView,
  type IpPrefixListWrite,
} from '../services/api/ip-prefix-lists.js';
import { agentPath } from '../services/routing.js';
import { roleCan } from '../services/session-store.js';
import { setPageBreadcrumb } from '../services/page-breadcrumb-store.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

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
 * One IP prefix list (/ip-prefix-lists/:listId, or /ip-prefix-lists/new):
 * name, description and entries, the harnesses that use it, and delete.
 */
export default function IpPrefixList() {
  const { listId = 'new' } = useParams<{ listId: string }>();
  const isNew = listId === 'new';
  const canManage = roleCan.manageProviders();
  const navigate = useNavigate();
  const detail = useResource(() => getIpPrefixList(listId), [listId], {
    enabled: !isNew && canManage,
  });
  const list = isNew ? null : (detail.data ?? null);
  const crumb = list ? list.name : isNew ? t('ipLists.form.createTitle') : null;
  const crumbPath = `/ip-prefix-lists/${listId}`;
  useEffect(() => {
    setPageBreadcrumb(crumb, crumbPath);
    return () => setPageBreadcrumb(null);
  }, [crumb, crumbPath]);

  const back = (
    <Link to="/ip-prefix-lists" className="text-sm text-muted hover:text-ink">
      {t('ipLists.back')}
    </Link>
  );

  if (!canManage) {
    return (
      <div className="page">
        {back}
        <div className="notice is-info mt-4">
          <span>{t('ipLists.adminOnly')}</span>
        </div>
      </div>
    );
  }
  if (!isNew && detail.error) {
    return (
      <div className="page">
        {back}
        <div className="mt-4">
          <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
        </div>
      </div>
    );
  }
  if (!isNew && !list) {
    return (
      <div className="page">
        <Skel width="100%" height={300} />
      </div>
    );
  }

  return (
    <div className="page">
      <title>
        {t('common.pageTitle', { page: list ? list.name : t('ipLists.form.createTitle') })}
      </title>
      <div className="mb-4">{back}</div>
      <ListForm
        list={list}
        onSaved={(saved) => {
          if (isNew) navigate(ipPrefixListPath(saved.id), { replace: true });
          else detail.setData(saved);
        }}
        onDeleted={() => navigate('/ip-prefix-lists')}
        onInUse={() => void detail.reload()}
      />
    </div>
  );
}

function ListForm({
  list,
  onSaved,
  onDeleted,
  onInUse,
}: {
  list: IpPrefixListView | null;
  onSaved: (list: IpPrefixListView) => void;
  onDeleted: () => void;
  onInUse: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(list));
  const [errors, setErrors] = useState<{ name?: string; entries?: string; server?: string }>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm(formOf(list));
    setErrors({});
  }, [list]);

  const save = async () => {
    const found: typeof errors = {};
    if (!form.name.trim()) found.name = t('ipLists.form.errors.name');
    const entryErr = entriesError(form.rows);
    if (entryErr) found.entries = entryErr;
    setErrors(found);
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

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <Panel title={t('ipLists.form.title')} bodyClassName="flex flex-col gap-4">
        <Field label={t('ipLists.form.name')} htmlFor="ip-list-name" error={errors.name}>
          <input
            id="ip-list-name"
            className="field"
            maxLength={100}
            value={form.name}
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
        {errors.server ? (
          <div className="notice is-danger" role="alert">
            <span>{errors.server}</span>
          </div>
        ) : null}
        <div className="actions">
          {list ? (
            <Button variant="ghost" size="sm" onClick={() => setForm(formOf(list))}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button size="sm" busy={saving} onClick={() => void save()}>
            {list ? t('common.saveChanges') : t('ipLists.form.createSubmit')}
          </Button>
        </div>
      </Panel>

      {list ? (
        <div className="flex flex-col gap-4">
          <Panel title={t('ipLists.usedBy.title')}>
            <HarnessLinks harnesses={list.harnesses} empty={t('ipLists.usedBy.none')} />
          </Panel>
          <DeletePanel list={list} onDeleted={onDeleted} onInUse={onInUse} />
        </div>
      ) : null}
    </div>
  );
}

function HarnessLinks({ harnesses, empty }: { harnesses: HarnessRef[]; empty: string }) {
  if (!harnesses.length) return <p className="m-0 text-sm text-muted">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
      {harnesses.map((h) => (
        <li key={h.name}>
          <Link to={agentPath(h.name, '/keys')} className="text-ink hover:underline">
            {h.displayName || h.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DeletePanel({
  list,
  onDeleted,
  onInUse,
}: {
  list: IpPrefixListView;
  onDeleted: () => void;
  onInUse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const inUse = list.harnesses.length > 0;

  const remove = async () => {
    setBusy(true);
    try {
      await deleteIpPrefixList(list.id, { silent: true });
      toast.success(t('ipLists.toast.deleted'));
      setOpen(false);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBlocked(err.message);
        setOpen(false);
        onInUse();
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel border-danger">
      <div className="panel-head">
        <h2 className="text-danger">{t('ipLists.delete.title')}</h2>
      </div>
      <div className="panel-body flex flex-col gap-3">
        {inUse ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="m-0 text-sm text-warn">{blocked ?? t('ipLists.delete.inUse')}</p>
            <HarnessLinks harnesses={list.harnesses} empty="" />
          </div>
        ) : (
          <p className="m-0 text-sm text-muted">{t('ipLists.delete.body')}</p>
        )}
        <div>
          <Button
            variant="danger"
            size="sm"
            disabled={inUse}
            onClick={() => {
              setBlocked(null);
              setOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            {t('ipLists.delete.button')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open}
        title={t('ipLists.delete.confirmTitle', { name: list.name })}
        message={blocked ?? t('ipLists.delete.confirmBody')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}
