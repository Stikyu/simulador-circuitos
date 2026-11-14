import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'nodal:tema';
const listeners = new Set<() => void>();

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // sin almacenamiento: se usa la preferencia del sistema
  }
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

let current: Theme = initial();

function apply() {
  document.documentElement.dataset.theme = current;
}
apply();

export function setTheme(theme: Theme) {
  current = theme;
  apply();
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // no se puede recordar la elección; no es grave
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => current);
}

/** Lee un color de las variables CSS del tema activo (para dibujar en canvas). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const SERIES_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
