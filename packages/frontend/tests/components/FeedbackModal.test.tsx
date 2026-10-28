import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import FeedbackModal, { FEEDBACK_TAGS } from '../../src/components/FeedbackModal';

// The modal renders in a portal on document.body, so queries go through document.
const q = (selector: string) => document.body.querySelector(selector) as HTMLElement | null;

describe('FeedbackModal', () => {
  it('does not render when closed', () => {
    render(<FeedbackModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(q('.overlay')).toBeNull();
  });

  it('renders when open', () => {
    render(<FeedbackModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(q('.overlay')).not.toBeNull();
    expect(q('.modal')).not.toBeNull();
  });

  it('renders all feedback tags', () => {
    render(<FeedbackModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const tags = document.body.querySelectorAll('.feedback-tag');
    expect(tags.length).toBe(FEEDBACK_TAGS.length);
    for (let i = 0; i < FEEDBACK_TAGS.length; i++) {
      expect(tags[i]!.textContent).toBe(FEEDBACK_TAGS[i]);
    }
  });

  it('toggles tag selection on click', () => {
    render(<FeedbackModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const tag = q('.feedback-tag')!;
    expect(tag.classList.contains('feedback-tag--selected')).toBe(false);
    fireEvent.click(tag);
    expect(tag.classList.contains('feedback-tag--selected')).toBe(true);
    expect(tag.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tag);
    expect(tag.classList.contains('feedback-tag--selected')).toBe(false);
  });

  it('calls onSubmit with selected tags and details', () => {
    const onSubmit = vi.fn();
    render(<FeedbackModal open={true} onClose={vi.fn()} onSubmit={onSubmit} />);
    const tags = document.body.querySelectorAll('.feedback-tag');
    fireEvent.click(tags[0]!);
    fireEvent.click(tags[2]!);

    const textarea = q('.feedback-modal__textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'test details' } });

    fireEvent.click(q('.feedback-modal__submit')!);

    expect(onSubmit).toHaveBeenCalledWith([FEEDBACK_TAGS[0], FEEDBACK_TAGS[2]], 'test details');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<FeedbackModal open={true} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.click(document.body.querySelector('[aria-label="Close"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking backdrop', () => {
    const onClose = vi.fn();
    render(<FeedbackModal open={true} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.mouseDown(q('.overlay')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking modal content', () => {
    const onClose = vi.fn();
    render(<FeedbackModal open={true} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.mouseDown(q('.modal')!);
    fireEvent.click(q('.modal')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<FeedbackModal open={true} onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('resets state after submit', () => {
    const onSubmit = vi.fn();
    render(<FeedbackModal open={true} onClose={vi.fn()} onSubmit={onSubmit} />);
    const tag = q('.feedback-tag')!;
    fireEvent.click(tag);
    expect(tag.classList.contains('feedback-tag--selected')).toBe(true);

    fireEvent.click(q('.feedback-modal__submit')!);

    // After submit, tags should be deselected
    expect(tag.classList.contains('feedback-tag--selected')).toBe(false);
  });

  it('renders textarea with placeholder', () => {
    render(<FeedbackModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const textarea = q('.feedback-modal__textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.placeholder).toBe('Share details (optional)');
  });
});
