import { useEffect, useState } from 'react';
import { Button, Modal, Switch } from './ui.js';
import { t } from '../i18n/index.js';

export interface LimitRuleData {
  metric_type: string;
  threshold: number;
  period: string;
  action: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: LimitRuleData) => Promise<void> | void;
  editData?: LimitRuleData | null;
  hasProvider?: boolean;
}

export default function LimitRuleModal({ open, onClose, onSave, editData }: Props) {
  const [blockEnabled, setBlockEnabled] = useState(false);
  const [metricType, setMetricType] = useState('tokens');
  const [threshold, setThreshold] = useState('');
  const [period, setPeriod] = useState('day');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setBlockEnabled(false);
    setMetricType('tokens');
    setThreshold('');
    setPeriod('day');
  };

  // The parent rebuilds `editData` on every render, so key the prefill on its
  // fields: opening (or switching the edited rule) fills the form once.
  const editKey = editData
    ? `${editData.metric_type}|${editData.threshold}|${editData.period}|${editData.action}`
    : null;
  useEffect(() => {
    if (!open) return;
    if (editData) {
      setMetricType(editData.metric_type);
      setThreshold(String(editData.threshold));
      setPeriod(editData.period);
      setBlockEnabled(editData.action === 'block' || editData.action === 'both');
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editKey]);

  const handleSave = async () => {
    if (saving) return;
    const val = Number(threshold);
    if (isNaN(val) || val <= 0) return;
    setSaving(true);
    try {
      await onSave({
        metric_type: metricType,
        threshold: val,
        period,
        action: blockEnabled ? 'both' : 'notify',
      });
      reset();
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const isEdit = !!editData;

  return (
    <Modal
      open={open}
      title={isEdit ? t('limits.editRule') : t('limits.createRule')}
      onClose={handleClose}
    >
      <div
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)
          ) {
            e.preventDefault();
            void handleSave();
          }
        }}
      >
        <p className="mb-4 text-sm text-muted">{t('limits.modal.desc')}</p>

        <div className="grid gap-4">
          <div>
            <label className="label" htmlFor="limit-metric-select">
              {t('limits.modal.metric')}
            </label>
            <select
              id="limit-metric-select"
              className="field"
              value={metricType}
              onChange={(e) => setMetricType(e.currentTarget.value)}
              autoFocus
            >
              <option value="tokens">{t('limits.modal.tokens')}</option>
              <option value="cost">{t('limits.modal.costUsd')}</option>
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="limit-threshold-input">
                {t('limits.modal.threshold')}
              </label>
              <input
                id="limit-threshold-input"
                className="field"
                type="number"
                min="0"
                step={metricType === 'cost' ? '0.01' : '1'}
                placeholder={
                  metricType === 'cost'
                    ? t('limits.modal.costPlaceholder')
                    : t('limits.modal.tokensPlaceholder')
                }
                value={threshold}
                onChange={(e) => setThreshold(e.currentTarget.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="limit-period-select">
                {t('limits.modal.period')}
              </label>
              <select
                id="limit-period-select"
                className="field"
                value={period}
                onChange={(e) => setPeriod(e.currentTarget.value)}
              >
                <option value="hour">{t('limits.period.hour')}</option>
                <option value="day">{t('limits.period.day')}</option>
                <option value="week">{t('limits.period.week')}</option>
                <option value="month">{t('limits.period.month')}</option>
              </select>
            </div>
          </div>

          <div className="limit-block-toggle well flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{t('limits.modal.blockWhenExceeded')}</span>
            <Switch
              checked={blockEnabled}
              onChange={setBlockEnabled}
              label={t('limits.modal.blockWhenExceeded')}
            />
          </div>
        </div>

        <div className="actions">
          <Button
            size="sm"
            disabled={!threshold || Number(threshold) <= 0}
            busy={saving}
            onClick={() => void handleSave()}
          >
            {isEdit ? t('common.saveChanges') : t('limits.createRule')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
