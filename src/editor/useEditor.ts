import { useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from './store';

export function useEditor(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
