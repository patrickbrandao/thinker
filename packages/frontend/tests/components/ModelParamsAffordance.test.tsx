import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, configure } from '@testing-library/react';
import type { ProviderParamSpec } from 'thinker-shared';

import ModelParamsAffordance, {
  resetRouteSpecsCache,
} from '../../src/components/ModelParamsAffordance';
import { getModelParamSpecs } from '../../src/services/api/model-params.js';

vi.mock('../../src/services/api/model-params.js', () => ({
  getModelParamSpecs: vi.fn(),
}));

const mockGetSpecs = vi.mocked(getModelParamSpecs);

const specs: ProviderParamSpec[] = [
  {
    path: 'thinking.type',
    type: 'enum',
    label: 'Thinking mode',
    description: 'Controls whether DeepSeek thinking mode is enabled.',
    default: 'enabled',
    values: ['enabled', 'disabled'],
    group: 'reasoning',
  },
];

const baseProps = {
  agentName: 'demo',
  provider: 'deepseek',
  authType: 'api_key' as const,
  model: 'deepseek-v4',
  slotLabel: 'deepseek-v4',
  scope: 'tier:default',
  getParams: vi.fn(() => null),
  setParams: vi.fn().mockResolvedValue(undefined),
};

const findButton = (container: HTMLElement) =>
  container.querySelector('button[aria-label^="Configure model parameters"]');

describe('ModelParamsAffordance', () => {
  beforeEach(() => {
    mockGetSpecs.mockReset();
    resetRouteSpecsCache();
    mockGetSpecs.mockResolvedValue(specs);
    // These assertions wait on a lazily-loaded resource (getModelParamSpecs) and a
    // reactive `Show` gate; the default 1s waitFor budget can be exceeded under CI
    // CPU contention, so give it headroom to avoid load-based flakes.
    configure({ asyncUtilTimeout: 5000 });
  });

  afterEach(() => {
    configure({ asyncUtilTimeout: 1000 });
  });

  it('renders the button for non-local routes with params', async () => {
    const { container } = render(<ModelParamsAffordance {...baseProps} />);
    await waitFor(() => expect(findButton(container)).not.toBeNull());
  });

  it('hides the button for a model with no parameters', async () => {
    mockGetSpecs.mockResolvedValue([]);
    const { container } = render(
      <ModelParamsAffordance {...baseProps} provider="openai" model="gpt-4o" slotLabel="gpt-4o" />,
    );
    await waitFor(() => expect(mockGetSpecs).toHaveBeenCalled());
    await Promise.resolve();
    expect(findButton(container)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps clicks inside the dialog from reaching the parent chip', async () => {
    const parentClick = vi.fn();
    const { container, findByRole } = render(
      <div onClick={parentClick}>
        <ModelParamsAffordance {...baseProps} />
      </div>,
    );
    await waitFor(() => expect(findButton(container)).not.toBeNull());
    fireEvent.click(findButton(container) as HTMLButtonElement);
    fireEvent.click(await findByRole('button', { name: /Thinking mode/ }));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('does not render the button when authType is missing', () => {
    const { container } = render(
      <ModelParamsAffordance
        agentName="demo"
        provider="deepseek"
        authType={undefined}
        model="deepseek-v4"
        slotLabel="deepseek-v4"
        scope="tier:default"
        getParams={() => null}
        setParams={vi.fn()}
      />,
    );
    expect(findButton(container)).toBeNull();
  });

  it('does not render the button when provider is undefined', () => {
    const { container } = render(
      <ModelParamsAffordance
        agentName="demo"
        provider={undefined}
        authType="api_key"
        model="deepseek-v4"
        slotLabel="deepseek-v4"
        scope="tier:default"
        getParams={() => null}
        setParams={vi.fn()}
      />,
    );
    expect(findButton(container)).toBeNull();
  });

  it('does not render the button for local routes', () => {
    const { container } = render(<ModelParamsAffordance {...baseProps} authType="local" />);
    expect(container.querySelector('button[aria-label^="Configure model parameters"]')).toBeNull();
  });

  it('flips the configured class when getParams returns a non-null value', () => {
    const { container } = render(
      <ModelParamsAffordance
        {...baseProps}
        getParams={() => ({ thinking: { type: 'disabled' } })}
      />,
    );
    const btn = findButton(container) as HTMLButtonElement;
    expect(btn.classList.contains('routing-card__chip-action--configured')).toBe(true);
  });

  it('fetches specs on open and saves through the scoped params callback', async () => {
    const setParams = vi.fn().mockResolvedValue(undefined);
    const { container, getByRole } = render(
      <ModelParamsAffordance {...baseProps} setParams={setParams} />,
    );
    await waitFor(() => expect(findButton(container)).not.toBeNull());
    fireEvent.click(findButton(container) as HTMLButtonElement);

    fireEvent.click(await waitFor(() => getByRole('button', { name: /Thinking mode/ })));
    fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setParams).toHaveBeenCalledWith('tier:default', 'deepseek', 'api_key', 'deepseek-v4', {
        thinking: { type: 'disabled' },
      });
    });
    expect(mockGetSpecs).toHaveBeenCalledWith('demo', 'deepseek', 'api_key', 'deepseek-v4');
  });

  it('saves null when the user resets the only stored param', async () => {
    const setParams = vi.fn().mockResolvedValue(undefined);
    const { container, getByRole } = render(
      <ModelParamsAffordance
        {...baseProps}
        getParams={() => ({ thinking: { type: 'disabled' } })}
        setParams={setParams}
      />,
    );
    fireEvent.click(findButton(container) as HTMLButtonElement);

    fireEvent.click(await waitFor(() => getByRole('button', { name: 'Reset Thinking mode' })));
    fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setParams).toHaveBeenCalledWith(
        'tier:default',
        'deepseek',
        'api_key',
        'deepseek-v4',
        null,
      );
    });
  });

  it('shows an empty state when saved params exist but the model has none now', async () => {
    mockGetSpecs.mockResolvedValue([]);
    const { container, findByText, queryByRole } = render(
      <ModelParamsAffordance
        {...baseProps}
        getParams={() => ({ thinking: { type: 'disabled' } })}
      />,
    );
    fireEvent.click(findButton(container) as HTMLButtonElement);

    expect(await findByText('No parameter controls are available for deepseek-v4.')).toBeTruthy();
    expect(queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('hides the button when the spec lookup fails', async () => {
    mockGetSpecs.mockRejectedValue(new Error('boom'));
    const { container } = render(<ModelParamsAffordance {...baseProps} />);
    await waitFor(() => expect(mockGetSpecs).toHaveBeenCalled());
    await Promise.resolve();
    expect(findButton(container)).toBeNull();
  });

  it('button is disabled when the parent says so', async () => {
    const { container } = render(<ModelParamsAffordance {...baseProps} disabled />);
    await waitFor(() => expect(findButton(container)).not.toBeNull());
    const btn = findButton(container) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
