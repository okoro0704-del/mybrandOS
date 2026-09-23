import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSpaceRuntime, reduceSpace, restoreSpace, serializeSpace, type SpaceDefinition, type SpaceEvent, type SpaceRuntime } from '@mybrandos/shared';

export function useSpaceRuntime(definition: SpaceDefinition, activate: (experienceId: string, spaceId: string) => Promise<void> | void, enabled = true, spaces?: readonly SpaceDefinition[]) {
  const registry = useMemo(() => spaces ?? [definition], [spaces, definition]);
  const key = 'space-contract-v1:' + definition.id;
  const read = () => {
    try {
      const restored = createSpaceRuntime(definition, restoreSpace(localStorage.getItem(key), definition));
      for (const entry of registry) {
        const snapshot = restoreSpace(localStorage.getItem('space-contract-v1:' + entry.id), entry);
        if (snapshot) restored.saved[entry.id] = snapshot;
      }
      return restored;
    }
    catch { return createSpaceRuntime(definition); }
  };
  const [state, setState] = useState<SpaceRuntime>(read);
  const current = useRef(state);
  current.current = state;
  const activateRef = useRef(activate);
  activateRef.current = activate;
  const dispatch = useCallback((event: SpaceEvent) => {
    const next = reduceSpace(current.current, event, registry);
    current.current = next;
    setState(next);
  }, [registry]);
  useEffect(() => {
    if (!enabled) return;
    const restored = read();
    current.current = restored;
    setState(restored);
    void activateRef.current(restored.currentExperienceId, restored.currentSpaceId);
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled || !registry.some(entry => entry.id === state.currentSpaceId)) return;
    try { localStorage.setItem('space-contract-v1:' + state.currentSpaceId, serializeSpace(state)); } catch { /* storage unavailable */ }
  }, [registry, state, enabled]);
  useEffect(() => {
    if (!enabled || state.presentationState !== 'REVEAL_HANDLE' || state.handlePinned) return;
    const timer = window.setTimeout(() => dispatch({ type: 'HANDLE_TIMEOUT' }), 4000);
    return () => window.clearTimeout(timer);
  }, [state.presentationState, state.handlePinned, dispatch, enabled]);
  useEffect(() => {
    const pending = state.pending;
    if (!enabled || !pending) return;
    let cancelled = false;
    Promise.resolve().then(() => activateRef.current(pending.experienceId, pending.spaceId)).then(
      () => { if (!cancelled) dispatch({ type: 'ACTIVATED', transitionId: pending.id }); },
      () => { if (!cancelled) dispatch({ type: 'ACTIVATION_FAILED', transitionId: pending.id }); },
    );
    return () => { cancelled = true; };
  }, [state.pending, dispatch, enabled]);
  return { state, dispatch, definition: registry.find(entry => entry.id === state.currentSpaceId) ?? definition };
}
