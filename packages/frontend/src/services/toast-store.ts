import { signal } from '../lib/signal.js';

export type ToastType = 'error' | 'success' | 'warning';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  error: 6000,
  success: 4000,
  warning: 5000,
};

let nextId = 0;

export const toasts = signal<Toast[]>([]);

export function addToast(type: ToastType, message: string, duration?: number) {
  const id = nextId++;
  const ms = duration ?? DEFAULT_DURATIONS[type];
  toasts.set((prev) => [...prev, { id, type, message, duration: ms }]);
  return id;
}

export function dismissToast(id: number) {
  toasts.set((prev) => prev.filter((t) => t.id !== id));
}

export const toast = {
  error: (message: string, duration?: number) => addToast('error', message, duration),
  success: (message: string, duration?: number) => addToast('success', message, duration),
  warning: (message: string, duration?: number) => addToast('warning', message, duration),
};
