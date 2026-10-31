import { createPortal } from 'react-dom';
import { Pencil, Trash2 } from 'lucide-react';
import type { NotificationRule } from '../services/api.js';
import { formatThreshold, periodLabel } from './LimitRuleTable.js';
import { Button, Modal } from './ui.js';
import { t } from '../i18n/index.js';

interface KebabMenuProps {
  openMenuId: string | null;
  menuPos: { top: number; left: number };
  rules: NotificationRule[];
  onEdit: (rule: NotificationRule) => void;
  onDelete: (rule: NotificationRule) => void;
}

/** Row actions for a limit rule, anchored under its kebab button. */
function KebabMenu({ openMenuId, menuPos, rules, onEdit, onDelete }: KebabMenuProps) {
  if (!openMenuId) return null;
  const rule = rules.find((r) => r.id === openMenuId);
  if (!rule) return null;
  return createPortal(
    <div
      className="rule-menu__dropdown menu"
      role="menu"
      style={{
        position: 'fixed',
        top: `${menuPos.top}px`,
        left: `${menuPos.left}px`,
        transform: 'translateX(-100%)',
        minWidth: 160,
      }}
    >
      <button type="button" className="menu-item" role="menuitem" onClick={() => onEdit(rule)}>
        <Pencil aria-hidden="true" />
        {t('common.edit')}
      </button>
      <button
        type="button"
        className="menu-item is-danger"
        role="menuitem"
        onClick={() => onDelete(rule)}
      >
        <Trash2 aria-hidden="true" />
        {t('common.delete')}
      </button>
    </div>,
    document.body,
  );
}

interface DeleteRuleModalProps {
  target: NotificationRule | null;
  confirmed: boolean;
  deleting: boolean;
  onConfirmChange: (checked: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
}

function DeleteRuleModal({
  target,
  confirmed,
  deleting,
  onConfirmChange,
  onCancel,
  onDelete,
}: DeleteRuleModalProps) {
  return (
    <Modal open={!!target} title={t('limits.deleteModal.title')} onClose={onCancel}>
      {target ? (
        <>
          <p className="text-sm text-dim">
            {t('limits.deleteModal.bodyBefore')}{' '}
            <span className="font-semibold text-ink">
              {target.metric_type === 'tokens'
                ? t('limits.deleteModal.token')
                : t('limits.deleteModal.cost')}
            </span>{' '}
            {t('limits.deleteModal.bodyAfter', {
              threshold: formatThreshold(target),
              period: periodLabel(target.period)?.toLowerCase() ?? target.period,
            })}
          </p>
          <label className="check mt-4">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => onConfirmChange(e.currentTarget.checked)}
            />
            {t('limits.deleteModal.confirm')}
          </label>
          <div className="actions">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!confirmed}
              busy={deleting}
              onClick={onDelete}
            >
              {t('limits.deleteModal.submit')}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

export { KebabMenu, DeleteRuleModal };
