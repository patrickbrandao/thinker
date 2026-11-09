import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReadOnlyRegion from '../../src/components/ReadOnlyRegion';

function Form() {
  return (
    <>
      <input aria-label="Name" />
      <select aria-label="Role">
        <option>a</option>
      </select>
      <button>Save</button>
      <a href="/docs">Docs</a>
    </>
  );
}

describe('ReadOnlyRegion', () => {
  it('leaves everything editable when the role can change the region', async () => {
    const { container } = render(
      <ReadOnlyRegion readOnly={false} notice="View only">
        <Form />
      </ReadOnlyRegion>,
    );
    expect(container.querySelector('fieldset')!.disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).matches(':disabled'),
    ).toBe(false);
    expect(screen.queryByRole('note')).toBeNull();
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('x');
  });

  it('disables every control inside while read-only, but keeps links and content visible', async () => {
    const { container } = render(
      <ReadOnlyRegion readOnly>
        <Form />
        <p>some data</p>
      </ReadOnlyRegion>,
    );
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    expect(screen.getByLabelText('Name').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Role').matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Save' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('link', { name: 'Docs' }).matches(':disabled')).toBe(false);
    expect(screen.getByText('some data')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('shows the notice only when read-only and a notice is given', () => {
    const { rerender } = render(
      <ReadOnlyRegion readOnly notice="Your role is read-only">
        <Form />
      </ReadOnlyRegion>,
    );
    expect(screen.getByRole('note').textContent).toBe('Your role is read-only');
    rerender(
      <ReadOnlyRegion readOnly>
        <Form />
      </ReadOnlyRegion>,
    );
    expect(screen.queryByRole('note')).toBeNull();
    rerender(
      <ReadOnlyRegion readOnly={false} notice="Your role is read-only">
        <Form />
      </ReadOnlyRegion>,
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('renders with no children', () => {
    const { container } = render(<ReadOnlyRegion readOnly />);
    expect(container.querySelector('fieldset')).not.toBeNull();
  });
});
