import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AGENT_NAME_PATTERN, toAgentName } from 'thinker-shared';
import { duplicateAgent, getDuplicatePreview } from '../services/api.js';
import { markAgentCreated } from '../services/recent-agents.js';
import { toast } from '../services/toast-store.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';
import { Button, Modal, Skel } from './ui.js';

interface Props {
  open: boolean;
  sourceName: string;
  onClose: () => void;
  onDuplicated?: () => void;
}

export default function DuplicateAgentModal({ open, sourceName, onClose, onDuplicated }: Props) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const cancelledInFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: preview } = useResource(async () => {
    if (!open || !sourceName) return null;
    return (await getDuplicatePreview(sourceName)) ?? null;
  }, [open, sourceName]);

  useEffect(() => {
    if (preview?.suggested_name && !nameTouched) setName(preview.suggested_name);
  }, [preview, nameTouched]);

  useEffect(() => {
    if (!open) {
      setName('');
      setNameTouched(false);
      setSubmitting(false);
      // Deliberately don't reset `cancelledInFlight` here — it must stay true
      // until the in-flight fetch returns so handleDuplicate can honor the
      // cancel. handleDuplicate resets it when starting a new request.
      return;
    }
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const requestClose = () => {
    if (submitting) cancelledInFlight.current = true;
    onClose();
  };

  const copied = open ? preview?.copied : undefined;
  const totalCopied = copied
    ? copied.providers + copied.tierAssignments + copied.specificityAssignments + copied.modelParams
    : 0;

  const handleDuplicate = async () => {
    const newName = name.trim();
    if (!AGENT_NAME_PATTERN.test(newName) || submitting) return;
    cancelledInFlight.current = false;
    setSubmitting(true);
    try {
      const result = await duplicateAgent(sourceName, newName);
      if (!result) return;
      if (cancelledInFlight.current) {
        // User closed the modal before the request finished. The agent was still
        // created on the server, so refresh the parent list but skip the toast
        // and navigation the user implicitly opted out of.
        onDuplicated?.();
        return;
      }
      const slug = result.agent.name;
      markAgentCreated(slug);
      toast.success(t('harnesses.duplicateModal.done', { source: sourceName, target: slug }));
      onClose();
      onDuplicated?.();
      navigate(`/harnesses/${encodeURIComponent(slug)}`, {
        state: { newApiKey: result.apiKey },
      });
    } catch {
      // error toast already shown by fetchMutate
    } finally {
      setSubmitting(false);
    }
  };

  const sectionHead = 'mb-2 flex items-center gap-2 text-xs font-semibold text-muted';
  const listClass = 'duplicate-agent__list m-0 flex list-none flex-col gap-1 p-0 text-sm text-dim';

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={t('harnesses.duplicateModal.title', { name: sourceName })}
    >
      <p className="mb-4 text-sm text-muted">{t('harnesses.duplicateModal.desc')}</p>

      <label className="label" htmlFor="duplicate-agent-name">
        {t('harnesses.duplicateModal.newName')}
      </label>
      <input
        ref={inputRef}
        id="duplicate-agent-name"
        className="field"
        type="text"
        placeholder={
          preview?.suggested_name ||
          t('harnesses.duplicateModal.copyPlaceholder', { name: sourceName })
        }
        value={name}
        onChange={(e) => {
          setNameTouched(true);
          setName(toAgentName(e.currentTarget.value));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleDuplicate();
        }}
        disabled={submitting}
      />

      <div className="duplicate-agent__section well mt-4">
        <div className={`duplicate-agent__section-header ${sectionHead}`}>
          {t('harnesses.duplicateModal.copied')}
          {copied ? <span className="badge">{totalCopied}</span> : null}
        </div>
        {copied ? (
          <ul className={listClass}>
            <li>
              <strong className="text-ink">{copied.providers}</strong>{' '}
              {t('harnesses.duplicateModal.providers', copied.providers)}
            </li>
            <li>
              <strong className="text-ink">{copied.tierAssignments}</strong>{' '}
              {t('harnesses.duplicateModal.tiers', copied.tierAssignments)}
            </li>
            <li>
              <strong className="text-ink">{copied.specificityAssignments}</strong>{' '}
              {t('harnesses.duplicateModal.specificity', copied.specificityAssignments)}
            </li>
          </ul>
        ) : (
          <Skel width="100%" height={64} />
        )}
      </div>

      <div className="duplicate-agent__section well mt-3">
        <div className={`duplicate-agent__section-header ${sectionHead}`}>
          {t('harnesses.duplicateModal.notCopied')}
        </div>
        <ul className={listClass}>
          <li>{t('harnesses.duplicateModal.requests')}</li>
          <li>{t('harnesses.duplicateModal.logs')}</li>
          <li>{t('harnesses.duplicateModal.notificationRules')}</li>
        </ul>
      </div>

      <div className="actions">
        <Button variant="ghost" size="sm" onClick={requestClose}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => void handleDuplicate()}
          disabled={!AGENT_NAME_PATTERN.test(name.trim())}
          busy={submitting}
        >
          {submitting ? null : t('harnesses.duplicateModal.submit')}
        </Button>
      </div>
    </Modal>
  );
}
