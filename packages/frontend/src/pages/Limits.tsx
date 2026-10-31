import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useParams } from 'react-router';
import { Info, Plus, TriangleAlert } from 'lucide-react';
import LimitRuleModal from '../components/LimitRuleModal.js';
import type { LimitRuleData } from '../components/LimitRuleModal.js';
import LimitRuleTable from '../components/LimitRuleTable.js';
import LimitHistoryTable from '../components/LimitHistoryTable.js';
import { KebabMenu, DeleteRuleModal } from '../components/LimitModals.js';
import ReadOnlyRegion from '../components/ReadOnlyRegion.js';
import { Button } from '../components/ui.js';
import { toast } from '../services/toast-store.js';
import { t } from '../i18n/index.js';
import { roleCan } from '../services/session-store.js';
import { agentDisplayName } from '../services/agent-display-name.js';
import { useResource } from '../lib/use-resource.js';
import { getHarnessTriggers, listTriggers } from '../services/api/triggers.js';
import {
  getNotificationRules,
  getNotificationLogs,
  createNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
  getRoutingStatus,
  type NotificationRule,
} from '../services/api.js';

/** Guardrails tab of a harness: spend/token rules and alert history. Triggers have their own tab. */
export default function Limits() {
  const params = useParams<{ agentName: string }>();
  const agentName = decodeURIComponent(params.agentName ?? '');

  const rules = useResource(() => getNotificationRules(agentName), [agentName]);
  const logs = useResource(() => getNotificationLogs(agentName), [agentName]);
  const routingStatus = useResource(() => getRoutingStatus(agentName), [agentName]);
  const triggers = useResource(() => listTriggers(), []);
  const bindings = useResource(() => getHarnessTriggers(agentName), [agentName]);

  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState<NotificationRule | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [deleteTarget, setDeleteTarget] = useState<NotificationRule | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const routingEnabled = routingStatus.data?.enabled ?? false;
  // Alerts are delivered when an enabled trigger bound to this harness gets
  // `limit.alert`. Assume one while the bindings load.
  const hasProvider =
    bindings.data === undefined ||
    bindings.data.some(
      (b) =>
        b.events.includes('limit.alert') &&
        (triggers.data?.find((tr) => tr.id === b.trigger_id)?.enabled ?? true),
    );
  const ruleList = rules.data ?? [];
  const blockRulesExceeded = ruleList.some(
    (r) =>
      (r.action === 'block' || r.action === 'both') && r.is_active && Number(r.trigger_count) > 0,
  );

  // The kebab menu closes on the next click anywhere on the page.
  const menuCleanup = useRef<(() => void) | null>(null);
  const closeMenu = () => {
    menuCleanup.current?.();
    menuCleanup.current = null;
    setOpenMenuId(null);
  };
  useEffect(() => () => menuCleanup.current?.(), []);

  const toggleMenu = (ruleId: string, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openMenuId === ruleId) {
      closeMenu();
      return;
    }
    menuCleanup.current?.();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right });
    setOpenMenuId(ruleId);
    const onDocClick = () => {
      menuCleanup.current = null;
      setOpenMenuId(null);
    };
    const timer = setTimeout(
      () => document.addEventListener('click', onDocClick, { once: true }),
      0,
    );
    menuCleanup.current = () => {
      clearTimeout(timer);
      document.removeEventListener('click', onDocClick);
    };
  };

  const handleEdit = (rule: NotificationRule) => {
    closeMenu();
    setEditRule(rule);
    setShowModal(true);
  };

  const handleSave = async (data: LimitRuleData) => {
    try {
      if (editRule) {
        await updateNotificationRule(editRule.id, { ...data });
        toast.success(t('limits.toast.ruleUpdated'));
      } else {
        await createNotificationRule({ agent_name: agentName, ...data });
        toast.success(t('limits.toast.ruleCreated'));
      }
      await rules.reload();
      setShowModal(false);
      setEditRule(null);
    } catch {
      // error toast from fetchMutate
    }
  };

  const openDeleteConfirm = (rule: NotificationRule) => {
    closeMenu();
    setDeleteTarget(rule);
    setDeleteConfirmed(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteNotificationRule(deleteTarget.id);
      await rules.reload();
      toast.success(t('limits.toast.ruleDeleted'));
    } catch {
      // error toast from fetchMutate
    } finally {
      setDeleting(false);
    }
    setDeleteTarget(null);
    setDeleteConfirmed(false);
  };

  const name = agentDisplayName() ?? agentName;
  const canManage = roleCan.manageProviders();
  const historyLogs = logs.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <title>{t('limits.pageTitle', { name })}</title>
      <meta name="description" content={t('limits.metaDescription', { name })} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('limits.subtitle')}</p>
        {canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditRule(null);
              setShowModal(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t('limits.createRule')}
          </Button>
        ) : null}
      </div>

      {blockRulesExceeded ? (
        <div className="notice is-danger" role="alert">
          <TriangleAlert aria-hidden="true" />
          <span>{t('limits.hardLimitTriggered')}</span>
        </div>
      ) : null}

      {routingStatus.data && !routingEnabled ? (
        <div className="notice is-info">
          <Info aria-hidden="true" />
          <div>
            <strong className="text-ink">{t('limits.connectProviderTitle')}</strong>
            <p className="mt-0.5 text-sm text-dim">{t('limits.connectProviderBody')}</p>
          </div>
        </div>
      ) : null}

      <ReadOnlyRegion readOnly={!canManage} notice={t('limits.readOnlyNotice')}>
        <LimitRuleTable
          rules={rules.data}
          loading={rules.loading && rules.data === undefined}
          hasProvider={hasProvider}
          onToggleMenu={toggleMenu}
        />
      </ReadOnlyRegion>

      {!logs.loading && historyLogs.length > 0 ? (
        <LimitHistoryTable logs={historyLogs} loading={false} />
      ) : null}

      <KebabMenu
        openMenuId={openMenuId}
        menuPos={menuPos}
        rules={ruleList}
        onEdit={handleEdit}
        onDelete={openDeleteConfirm}
      />

      <DeleteRuleModal
        target={deleteTarget}
        confirmed={deleteConfirmed}
        deleting={deleting}
        onConfirmChange={setDeleteConfirmed}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteConfirmed(false);
        }}
        onDelete={() => void handleDelete()}
      />

      <LimitRuleModal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditRule(null);
        }}
        onSave={handleSave}
        hasProvider={hasProvider}
        editData={
          editRule
            ? {
                metric_type: editRule.metric_type,
                threshold: Number(editRule.threshold),
                period: editRule.period,
                action: editRule.action ?? 'notify',
              }
            : null
        }
      />
    </div>
  );
}
