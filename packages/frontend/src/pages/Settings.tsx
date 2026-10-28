import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Eye, EyeOff } from 'lucide-react';
import {
  type AgentCategory,
  type AgentPlatform,
  PLATFORMS_BY_CATEGORY,
  platformIcon,
} from 'thinker-shared';
import CopyButton from '../components/CopyButton.js';
import ReadOnlyRegion from '../components/ReadOnlyRegion.js';
import ErrorState from '../components/ErrorState.js';
import AgentTypeGrid from '../components/AgentTypeGrid.js';
import SetupStepAddProvider from '../components/SetupStepAddProvider.js';
import SetupModal from '../components/SetupModal.js';
import RichText from '../components/RichText.js';
import { Button, IconButton, Modal, Panel, Skel } from '../components/ui.js';
import SettingsRecordingSection from './SettingsRecordingSection.js';
import SettingsModelListingSection from './SettingsModelListingSection.js';
import SettingsRow from './SettingsRow.js';
import { me, roleCan } from '../services/session-store.js';
import { agentDisplayNameSignal } from '../services/agent-display-name.js';
import { installOrigin } from '../services/install-endpoints.js';
import {
  deleteAgent,
  getAgentInfo,
  getAgentKey,
  renameAgent,
  rotateAgentKey,
  updateAgent,
} from '../services/api.js';
import { listVirtualModels } from '../services/api/virtual-models.js';
import { markAgentCreated } from '../services/recent-agents.js';
import { toast } from '../services/toast-store.js';
import { setAgentPlatform } from '../services/agent-platform-store.js';
import { categoryLabel, platformLabel } from '../services/agent-type-labels.js';
import { useSignal } from '../lib/signal.js';
import { useResource } from '../lib/use-resource.js';
import { t } from '../i18n/index.js';

/** Catches a render crash in the key/setup block and offers a retry. */
class SectionBoundary extends Component<
  { children: ReactNode; fallback: (error: unknown, reset: () => void) => ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('Unknown error') };
  }
  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    /* shown in the fallback */
  }
  reset = () => this.setState({ error: null });
  render() {
    return this.state.error
      ? this.props.fallback(this.state.error, this.reset)
      : this.props.children;
  }
}

/** Harness Settings tab, rendered inside AgentDetail at /harnesses/:agentName/settings. */
export default function Settings() {
  const params = useParams<{ agentName: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const agentName = decodeURIComponent(params.agentName ?? '');
  useSignal(me);
  const displayName = useSignal(agentDisplayNameSignal) ?? agentName;
  const canEdit = roleCan.editHarnesses();

  const [name, setName] = useState(agentName);
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotatedKey, setRotatedKey] = useState<string | null>(
    (location.state as { newApiKey?: string } | null)?.newApiKey ?? null,
  );
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalCategory, setModalCategory] = useState<AgentCategory | null>(null);
  const [modalPlatform, setModalPlatform] = useState<AgentPlatform | null>(null);
  const [savingType, setSavingType] = useState(false);
  const [keyRevealed, setKeyRevealed] = useState(false);

  const agentInfo = useResource(() => getAgentInfo(agentName), [agentName]);
  const apiKeyData = useResource(() => getAgentKey(agentName), [agentName]);
  // Enabled virtual models, shown in the setup snippets.
  const virtualModelList = useResource(
    () =>
      listVirtualModels(agentName).catch(() => [] as Awaited<ReturnType<typeof listVirtualModels>>),
    [agentName],
  );
  const virtualModels = (virtualModelList.data ?? []).filter((v) => v.enabled).map((v) => v.name);

  const currentCategory = (agentInfo.data?.agent_category as AgentCategory | undefined) ?? null;
  const currentPlatform = (agentInfo.data?.agent_platform as AgentPlatform | undefined) ?? null;
  const typeIcon = platformIcon(currentPlatform, currentCategory);

  const openTypeModal = () => {
    setModalCategory(currentCategory);
    setModalPlatform(currentPlatform);
    setShowTypeModal(true);
  };

  const handleSaveType = async () => {
    if (!modalCategory || !modalPlatform) return;
    setSavingType(true);
    try {
      await updateAgent(agentName, {
        agent_category: modalCategory,
        agent_platform: modalPlatform,
      });
      setAgentPlatform(modalPlatform, modalCategory);
      await agentInfo.reload();
      await apiKeyData.reload();
      setShowTypeModal(false);
      setShowSetupModal(true);
    } catch {
      // error toast handled by fetchMutate
    } finally {
      setSavingType(false);
    }
  };

  const keyData = apiKeyData.error ? undefined : apiKeyData.data;
  const fullKey = rotatedKey ?? keyData?.apiKey ?? null;
  const maskedKey = `${keyData?.keyPrefix ?? '...'}...`;
  const displayedKey = fullKey && keyRevealed ? fullKey : maskedKey;
  const baseUrl = `${installOrigin()}/v1`;

  const handleDeleteAgent = async () => {
    if (deleteConfirmName !== agentName || deleting) return;
    setDeleting(true);
    try {
      await deleteAgent(agentName);
      toast.success(t('harnesses.deleted', { name: agentName }));
      navigate('/harnesses', { replace: true });
    } catch {
      setDeleting(false);
    }
  };

  const nameChanged = name.trim() !== agentName && name.trim() !== '';

  const handleSaveName = async () => {
    if (!nameChanged) return;
    setSaving(true);
    try {
      const result = await renameAgent(agentName, name.trim());
      const slug = (result?.name as string) ?? name.trim();
      markAgentCreated(slug);
      window.location.replace(`/harnesses/${encodeURIComponent(slug)}/settings`);
    } catch {
      setName(agentName);
    } finally {
      setSaving(false);
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    try {
      const result = await rotateAgentKey(agentName);
      setRotatedKey(result.apiKey);
      setKeyRevealed(true);
      toast.success(t('harnesses.settings.rotated'));
      void apiKeyData.reload();
    } catch {
      // error toast handled by fetchMutate
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <title>
        {t('common.pageTitle', {
          page: t('harnesses.settings.pageTitle', { name: displayName }),
        })}
      </title>
      <meta
        name="description"
        content={t('harnesses.settings.metaDescription', { name: displayName })}
      />
      <p className="text-sm text-muted">{t('harnesses.settings.intro')}</p>

      <ReadOnlyRegion readOnly={!canEdit} notice={t('harnesses.settings.readOnly')}>
        <div className="flex flex-col gap-4">
          {/* -- Harness name ------------------------------ */}
          <Panel>
            <SettingsRow
              title={t('harnesses.settings.nameTitle')}
              description={t('harnesses.settings.nameDesc')}
            >
              <input
                className="field sm:w-60"
                type="text"
                aria-label={t('harnesses.settings.nameTitle')}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <Button
                size="sm"
                onClick={() => void handleSaveName()}
                disabled={!nameChanged}
                busy={saving}
              >
                {saving ? <span className="sr-only">{t('common.saving')}</span> : t('common.save')}
              </Button>
            </SettingsRow>
          </Panel>

          {/* -- Harness type (read-only + change modal) --- */}
          <Panel title={t('harnesses.settings.typeTitle')}>
            <SettingsRow
              title={
                <>
                  {typeIcon ? (
                    <img
                      src={typeIcon}
                      alt=""
                      width="18"
                      height="18"
                      className="platform-icon settings-type__icon shrink-0"
                    />
                  ) : null}
                  {currentPlatform
                    ? platformLabel(currentPlatform)
                    : t('harnesses.settings.notSet')}
                </>
              }
              description={currentCategory ? categoryLabel(currentCategory) : undefined}
            >
              <Button variant="ghost" size="sm" onClick={openTypeModal}>
                {t('harnesses.settings.change')}
              </Button>
            </SettingsRow>
          </Panel>

          {/* -- Message recording ------------------------- */}
          <SettingsRecordingSection agentName={agentName} />

          {/* -- /v1/models listing ------------------------ */}
          <SettingsModelListingSection agentName={agentName} />

          {/* -- API key and setup ------------------------- */}
          <SectionBoundary
            fallback={(err, reset) => (
              <div className="panel">
                <ErrorState
                  error={err}
                  title={t('common.somethingWentWrong')}
                  message={t('harnesses.settings.errorMessage')}
                  onRetry={reset}
                />
              </div>
            )}
          >
            <Panel title={t('harnesses.settings.apiKeyTitle')}>
              <SettingsRow
                title={t('harnesses.settings.apiKeyLabel')}
                description={t('harnesses.settings.apiKeyDesc')}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-control border border-line bg-sunken px-3 py-2 font-mono text-xs text-ink">
                  {displayedKey}
                </code>
                {fullKey ? (
                  <>
                    <IconButton
                      label={
                        keyRevealed ? t('harnesses.key.hideAria') : t('harnesses.key.revealAria')
                      }
                      title={
                        keyRevealed ? t('harnesses.key.hideShort') : t('harnesses.key.revealShort')
                      }
                      onClick={() => setKeyRevealed(!keyRevealed)}
                    >
                      {keyRevealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </IconButton>
                    <CopyButton text={fullKey} />
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRotate()}
                  busy={rotating}
                >
                  {rotating ? (
                    <span className="sr-only">{t('harnesses.settings.rotating')}</span>
                  ) : (
                    t('harnesses.settings.rotate')
                  )}
                </Button>
              </div>
            </Panel>

            <Panel title={t('harnesses.settings.setupTitle')}>
              {apiKeyData.loading && !apiKeyData.data && !apiKeyData.error ? (
                <Skel width="100%" height={200} />
              ) : (
                <>
                  {apiKeyData.error ? (
                    <div className="notice is-warn mb-3" role="alert">
                      <span>
                        <RichText
                          text={t('harnesses.settings.keyLoadError')}
                          parts={{ rotate: <strong>{t('harnesses.settings.rotate')}</strong> }}
                        />
                      </span>
                    </div>
                  ) : null}
                  <SetupStepAddProvider
                    apiKey={fullKey}
                    keyPrefix={keyData?.keyPrefix ?? null}
                    baseUrl={baseUrl}
                    hideFullKey
                    platform={currentPlatform}
                    virtualModels={virtualModels}
                  />
                </>
              )}
            </Panel>
          </SectionBoundary>

          {/* -- Danger zone -------------------------------- */}
          <section className="panel border-danger">
            <div className="panel-head">
              <h2 className="text-danger">{t('harnesses.settings.dangerTitle')}</h2>
            </div>
            <div className="panel-body">
              <SettingsRow
                title={t('harnesses.settings.deleteTitle')}
                description={t('harnesses.settings.deleteDesc')}
              >
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setShowDeleteModal(true);
                    setDeleteConfirmName('');
                  }}
                >
                  {t('harnesses.settings.deleteButton')}
                </Button>
              </SettingsRow>
            </div>
          </section>
        </div>
      </ReadOnlyRegion>

      {/* -- Delete modal ------------------------------ */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={t('harnesses.settings.deleteModalTitle', { name: agentName })}
      >
        <p className="mb-4 text-sm text-muted">
          <RichText
            text={t('harnesses.settings.deleteModalBody')}
            parts={{ name: <strong className="text-ink">{agentName}</strong> }}
          />
        </p>
        <label className="label" htmlFor="delete-confirm-input">
          <RichText
            text={t('harnesses.settings.deleteModalConfirm')}
            parts={{ name: <strong className="text-ink">"{agentName}"</strong> }}
          />
        </label>
        <input
          id="delete-confirm-input"
          className="field"
          type="text"
          value={deleteConfirmName}
          onChange={(e) => setDeleteConfirmName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleDeleteAgent();
            }
          }}
          placeholder={agentName}
        />
        <div className="actions">
          <Button
            variant="danger"
            size="sm"
            block
            disabled={deleteConfirmName !== agentName}
            busy={deleting}
            onClick={() => void handleDeleteAgent()}
          >
            {deleting ? (
              <span className="sr-only">{t('common.deleting')}</span>
            ) : (
              t('harnesses.settings.deleteModalButton')
            )}
          </Button>
        </div>
      </Modal>

      {/* -- Change type modal ----------------------- */}
      <Modal
        open={showTypeModal}
        onClose={() => setShowTypeModal(false)}
        title={t('harnesses.settings.changeTypeTitle')}
        wide
      >
        <p className="mb-4 text-sm text-muted">{t('harnesses.settings.changeTypeDesc')}</p>
        <AgentTypeGrid
          category={modalCategory}
          platform={modalPlatform}
          onCategoryChange={(c) => {
            setModalCategory(c);
            setModalPlatform(PLATFORMS_BY_CATEGORY[c][0] ?? null);
          }}
          onPlatformChange={setModalPlatform}
          disabled={savingType}
        />
        <div className="actions">
          <Button
            size="sm"
            onClick={() => void handleSaveType()}
            disabled={!modalCategory || !modalPlatform}
            busy={savingType}
          >
            {savingType ? null : t('common.save')}
          </Button>
        </div>
      </Modal>

      <SetupModal
        open={showSetupModal}
        agentName={agentName}
        agentPlatform={currentPlatform}
        agentCategory={currentCategory}
        onClose={() => setShowSetupModal(false)}
        onDone={() => setShowSetupModal(false)}
      />
    </div>
  );
}
