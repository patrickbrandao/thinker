import { useState } from 'react';
import { t, tMaybe } from '../i18n/index.js';
import { Button, Modal, cx } from './ui.js';

export const FEEDBACK_TAGS = [
  'Not expected tier',
  'Poor answer quality',
  'Too slow',
  'Buggy',
  'Other',
] as const;

const FEEDBACK_TAG_KEYS: Record<(typeof FEEDBACK_TAGS)[number], string> = {
  'Not expected tier': 'notExpectedTier',
  'Poor answer quality': 'poorQuality',
  'Too slow': 'tooSlow',
  Buggy: 'buggy',
  Other: 'other',
};

/** Tags are sent in English; only their display is translated. */
function tagLabel(tag: string): string {
  const key = FEEDBACK_TAG_KEYS[tag as (typeof FEEDBACK_TAGS)[number]];
  return (key && tMaybe(`ui.feedback.tags.${key}`)) ?? tag;
}

export interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (tags: string[], details: string) => void;
}

export default function FeedbackModal({ open, onClose, onSubmit }: FeedbackModalProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [details, setDetails] = useState('');

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
  }

  function handleSubmit() {
    onSubmit(selectedTags, details);
    setSelectedTags([]);
    setDetails('');
  }

  function handleClose() {
    setSelectedTags([]);
    setDetails('');
    onClose();
  }

  return (
    <Modal open={open} title={t('ui.feedback.title')} onClose={handleClose}>
      <div className="feedback-modal__tags mb-3 flex flex-wrap gap-1.5">
        {FEEDBACK_TAGS.map((tag) => {
          const selected = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={cx(
                'feedback-tag btn btn-sm',
                selected ? 'feedback-tag--selected' : 'btn-ghost',
              )}
              aria-pressed={selected}
              onClick={() => toggleTag(tag)}
            >
              {tagLabel(tag)}
            </button>
          );
        })}
      </div>
      <textarea
        className="feedback-modal__textarea field min-h-24 py-2"
        placeholder={t('ui.feedback.details')}
        value={details}
        onChange={(e) => setDetails(e.currentTarget.value)}
        maxLength={2000}
      />
      <div className="actions">
        <Button className="feedback-modal__submit" onClick={handleSubmit}>
          {t('ui.feedback.submit')}
        </Button>
      </div>
    </Modal>
  );
}
