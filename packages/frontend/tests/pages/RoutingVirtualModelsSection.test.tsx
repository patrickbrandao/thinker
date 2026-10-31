import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';

const mockList = vi.fn();
const mockDelete = vi.fn();
const mockReorder = vi.fn();
const mockOverride = vi.fn();
vi.mock('../../src/services/api/virtual-models.js', () => ({
  listVirtualModels: (...a: unknown[]) => mockList(...a),
  deleteVirtualModel: (...a: unknown[]) => mockDelete(...a),
  reorderVirtualModels: (...a: unknown[]) => mockReorder(...a),
  setVirtualModelOverride: (...a: unknown[]) => mockOverride(...a),
}));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('../../src/services/toast-store.js', () => ({
  toast: {
    error: (...a: unknown[]) => mockToastError(...a),
    success: (...a: unknown[]) => mockToastSuccess(...a),
  },
}));

// The card and the modals have their own tests; a light stand-in exposes the
// callbacks the section wires up.
vi.mock('../../src/components/VirtualModelCard.js', () => ({
  default: (props: Record<string, any>) => (
    <div data-testid={`card-${props.virtualModel.name}`}>
      <span>{props.virtualModel.name}</span>
      {props.dragHandle}
      <button onClick={() => props.onDelete()}>delete</button>
      <button onClick={() => props.onEdit()}>edit</button>
      <button onClick={() => props.onShowExample()}>example</button>
      <button onClick={() => props.onOverride('m', 'p', 'api_key', 'Main')}>override</button>
      <button onClick={() => props.onFallbacksUpdate(['f'], [{ model: 'f' }])}>fallbacks</button>
      <button onClick={() => props.onFallbacksUpdate([], undefined)}>reset</button>
      {props.onMoveUp && <button onClick={() => props.onMoveUp()}>up</button>}
      {props.onMoveDown && <button onClick={() => props.onMoveDown()}>down</button>}
      <span data-testid={`fb-${props.virtualModel.name}`}>
        {(props.virtualModel.fallback_routes ?? [])
          .map((r: { model: string }) => r.model)
          .join(',')}
      </span>
    </div>
  ),
}));
vi.mock('../../src/components/VirtualModelModal.js', () => ({
  default: (props: Record<string, any>) => (
    <div data-testid="vm-modal">
      <span>{props.editing ? `editing ${props.editing.name}` : 'creating'}</span>
      <button
        onClick={() =>
          props.onSaved({ ...vm('created', 'vm-new'), name: props.editing?.name ?? 'created' })
        }
      >
        save
      </button>
      {props.onPartialSave && (
        <button onClick={() => props.onPartialSave({ ...props.editing, name: 'renamed' })}>
          partial
        </button>
      )}
      {props.onDelete && (
        <button onClick={() => props.onDelete(props.editing.id)}>modal-delete</button>
      )}
    </div>
  ),
}));
vi.mock('../../src/components/VirtualModelSnippetModal.js', () => ({
  default: (props: Record<string, any>) => (
    <div data-testid="snippet">snippet for {props.virtualModel.name}</div>
  ),
}));

import RoutingVirtualModelsSection, { moveId } from '../../src/pages/RoutingVirtualModelsSection';
import type { VirtualModel } from '../../src/services/api/virtual-models';

function vm(name: string, id = name, extra: Partial<VirtualModel> = {}): VirtualModel {
  return {
    id,
    agent_id: 'agent-1',
    name,
    sort_order: 0,
    enabled: true,
    override_route: null,
    fallback_routes: null,
    continue_on_default: false,
    response_mode: 'buffered',
    output_modality: 'text',
    created_at: '',
    updated_at: '',
    shadows: [],
    context_length: null,
    ...extra,
  };
}

let openCreate: (() => void) | undefined;

function renderSection(leading?: React.ReactNode) {
  return render(
    <RoutingVirtualModelsSection
      agentName="demo"
      models={[]}
      customProviders={[]}
      connectedProviders={[]}
      leading={leading}
      onCreateRef={(open) => {
        openCreate = open;
      }}
    />,
  );
}

const order = () =>
  screen.getAllByTestId(/^card-/).map((el) => el.getAttribute('data-testid')!.slice(5));

describe('moveId', () => {
  it('moves an id and clamps the target', () => {
    expect(moveId(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
    expect(moveId(['a'], 5, 0)).toEqual(['a']);
  });
});

describe('RoutingVirtualModelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the leading card first and opens the create modal through the opener', async () => {
    mockList.mockResolvedValue([vm('a', 'vm-a')]);
    renderSection(<div data-testid="card-auto" />);
    await screen.findByTestId('card-a');
    expect(order()).toEqual(['auto', 'a']);
    act(() => openCreate?.());
    await screen.findByText('creating');
  });

  it('adds the card after a create without opening the example', async () => {
    mockList.mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    act(() => openCreate?.());
    fireEvent.click(await screen.findByText('save'));
    await screen.findByTestId('card-created');
    expect(screen.queryByTestId('snippet')).toBeNull();
    expect(mockToastSuccess).toHaveBeenCalledWith('Created "created"');
  });

  it('lists every virtual model, active or not, in order', async () => {
    mockList.mockResolvedValue([vm('a'), vm('b', 'b', { enabled: false })]);
    renderSection();
    await screen.findByTestId('card-a');
    expect(order()).toEqual(['a', 'b']);
    expect(mockList).toHaveBeenCalledWith('demo');
  });

  it('toasts when the list cannot load', async () => {
    mockList.mockRejectedValue(new Error('nope'));
    renderSection();
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('nope'));
  });

  it('sets the primary and applies fallback updates, reloading after each', async () => {
    const f = { provider: 'p', authType: 'api_key' as const, model: 'f' };
    mockList.mockResolvedValue([vm('a')]);
    mockOverride.mockResolvedValue(vm('a'));
    renderSection();
    fireEvent.click(await screen.findByText('override'));
    expect(mockOverride).toHaveBeenCalledWith('demo', 'a', 'm', 'p', 'api_key', 'Main');
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    mockList.mockResolvedValue([vm('a', 'a', { fallback_routes: [f] })]);
    fireEvent.click(screen.getByText('fallbacks'));
    expect(screen.getByTestId('fb-a').textContent).toBe('f');
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByText('reset'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(4));
  });

  it('reloads the list after a card write, for the computed context length and shadows', async () => {
    mockList.mockResolvedValueOnce([vm('a')]);
    mockList.mockResolvedValueOnce([vm('a', 'a', { context_length: 64000, shadows: ['x'] })]);
    mockOverride.mockResolvedValue(vm('a'));
    renderSection();
    const card = await screen.findByTestId('card-a');
    fireEvent.click(screen.getByText('override'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    // The reload reconciles by id: the card is kept, not remounted.
    expect(screen.getByTestId('card-a')).toBe(card);
  });

  it('keeps the list when a reload fails', async () => {
    mockList.mockResolvedValueOnce([vm('a')]).mockRejectedValueOnce(new Error('down'));
    mockOverride.mockResolvedValue(vm('a'));
    renderSection();
    fireEvent.click(await screen.findByText('override'));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('down'));
    expect(screen.getByTestId('card-a')).toBeTruthy();
  });

  it('updates the card with what a partly failed edit saved', async () => {
    mockList.mockResolvedValue([vm('a')]);
    renderSection();
    fireEvent.click(await screen.findByText('edit'));
    fireEvent.click(await screen.findByText('partial'));
    await screen.findByTestId('card-renamed');
    // The modal stays open with its inline error.
    expect(screen.getByTestId('vm-modal')).toBeTruthy();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('deletes after confirmation', async () => {
    mockList.mockResolvedValue([vm('a'), vm('b')]);
    mockDelete.mockResolvedValue(undefined);
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderSection();
    await screen.findByTestId('card-a');
    fireEvent.click(screen.getAllByText('delete')[0]!);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/per-model parameters/));
    expect(mockDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText('delete')[0]!);
    await waitFor(() => expect(screen.queryByTestId('card-a')).toBeNull());
    expect(mockDelete).toHaveBeenCalledWith('demo', 'a');
    confirm.mockRestore();
  });

  it('edits and deletes from the modal', async () => {
    mockList.mockResolvedValue([vm('a')]);
    mockDelete.mockResolvedValue(undefined);
    renderSection();
    fireEvent.click(await screen.findByText('edit'));
    await screen.findByText('editing a');
    fireEvent.click(screen.getByText('modal-delete'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('demo', 'a'));
    expect(screen.queryByTestId('vm-modal')).toBeNull();
  });

  it('opens the example from a card', async () => {
    mockList.mockResolvedValue([vm('a')]);
    renderSection();
    fireEvent.click(await screen.findByText('example'));
    expect(screen.getByTestId('snippet').textContent).toContain('a');
  });

  it('reorders with the menu and posts every id', async () => {
    mockList.mockResolvedValue([vm('a'), vm('b'), vm('c')]);
    mockReorder.mockResolvedValue({ ok: true });
    renderSection();
    await screen.findByTestId('card-a');
    expect(screen.getAllByText('up').length).toBe(2);
    fireEvent.click(screen.getAllByText('down')[0]!);
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(mockReorder).toHaveBeenCalledWith('demo', ['b', 'a', 'c']);
  });

  it('reorders with the keyboard on the drag handle', async () => {
    mockList.mockResolvedValue([vm('a'), vm('b')]);
    mockReorder.mockResolvedValue({ ok: true });
    renderSection();
    await screen.findByTestId('card-a');
    const handle = screen.getByLabelText(/Reorder b/);
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(order()).toEqual(['b', 'a']);
    // Focus stays on the moved card's handle, and the move is announced.
    expect(document.activeElement).toBe(screen.getByLabelText(/Reorder b/));
    expect(screen.getByRole('status').textContent).toBe('"b" moved to position 1 of 2');
    // Moving past the edge does nothing.
    fireEvent.keyDown(screen.getByLabelText(/Reorder b/), { key: 'ArrowLeft' });
    expect(mockReorder).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(order()).toEqual(['a', 'b']);
    expect(document.activeElement).toBe(screen.getByLabelText(/Reorder b/));
    expect(screen.getByRole('status').textContent).toBe('"b" moved to position 2 of 2');
  });

  it('reorders by drag and drop and reloads when the save fails', async () => {
    mockList.mockResolvedValue([vm('a'), vm('b'), vm('c')]);
    mockReorder.mockRejectedValue(new Error('bad'));
    renderSection();
    await screen.findByTestId('card-a');
    const slots = () => screen.getAllByRole('listitem');
    fireEvent.pointerDown(screen.getByLabelText(/Reorder c/));
    expect(slots()[2]!.getAttribute('draggable')).toBe('true');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(slots()[2]!, { dataTransfer });
    fireEvent.dragOver(slots()[0]!, { dataTransfer });
    expect(slots()[0]!.classList.contains('virtual-model-slot--drop-target')).toBe(true);
    fireEvent.drop(slots()[0]!, { dataTransfer });
    expect(order()).toEqual(['c', 'a', 'b']);
    expect(mockReorder).toHaveBeenCalledWith('demo', ['c', 'a', 'b']);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('hides the drag handle with a single virtual model', async () => {
    mockList.mockResolvedValue([vm('a')]);
    renderSection();
    await screen.findByTestId('card-a');
    expect(screen.queryByLabelText(/Reorder a/)).toBeNull();
  });
});
