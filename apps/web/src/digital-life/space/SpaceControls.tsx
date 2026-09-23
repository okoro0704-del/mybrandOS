import { useEffect, useRef, type ReactNode } from 'react';
import type { SpaceDefinition, SpaceEvent, SpaceRuntime } from '@mybrandos/shared';

export function SpaceControls({ state, definition, dispatch, children }: {
  state: SpaceRuntime; definition: SpaceDefinition; dispatch: (event: SpaceEvent) => void; children?: ReactNode;
}) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);
  const controls = state.presentationState === 'SUMMONED_UI' || (state.persistentUI && state.presentationState === 'GLASS');
  const handle = state.presentationState === 'REVEAL_HANDLE' || state.handlePinned;
  return <div data-space-controls={state.presentationState} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 90 }}>
    {handle && !controls && state.presentationState !== 'INTERACTION' ? <button type="button"
      aria-label="Open Space controls" aria-pressed={state.handlePinned}
      style={{ position: 'absolute', right: 10, top: '50%', width: 12, height: 40, padding: 0,
        border: '1px solid #ffffff66', borderRadius: 12, background: '#ffffff18', pointerEvents: 'auto', touchAction: 'manipulation' }}
      onClick={event => {
        event.stopPropagation();
        if (event.detail === 0) { dispatch({ type: 'TAP_HANDLE' }); return; }
        if (clickTimer.current) {
          clearTimeout(clickTimer.current); clickTimer.current = null;
          dispatch({ type: 'DOUBLE_TAP_HANDLE' });
        } else clickTimer.current = setTimeout(() => {
          clickTimer.current = null; dispatch({ type: 'TAP_HANDLE' });
        }, 320);
      }} /> : null}
    {controls ? <nav aria-label="Space controls" style={{ position: 'absolute', right: 24, bottom: 24,
      display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 'min(420px, 90vw)', padding: 12, borderRadius: 16,
      color: 'white', background: '#101820aa', backdropFilter: 'blur(14px)', pointerEvents: 'auto' }}>
      {definition.experiences.map(experience => <button type="button" key={experience.id}
        aria-current={state.currentExperienceId === experience.id ? 'true' : undefined}
        onClick={() => dispatch({ type: 'SELECT_EXPERIENCE', experienceId: experience.id })}>{experience.title}</button>)}
      <button type="button" onClick={() => dispatch({ type: 'OPEN_INTERACTIONS' })}>Interactions</button>
      <button type="button" aria-pressed={state.persistentUI} onClick={() => dispatch({ type: 'KEEP_UI' })}>Keep UI</button>
      <button type="button" onClick={() => dispatch({ type: 'HIDE_UI' })}>Hide UI</button>
      {children}
    </nav> : null}
    {state.presentationState === 'INTERACTION' ? <button type="button" style={{ position: 'absolute', right: 24, top: 24, pointerEvents: 'auto' }}
      onClick={() => dispatch({ type: 'CLOSE_INTERACTIONS' })}>Close interactions</button> : null}
    {state.error ? <p role="alert" style={{ position: 'absolute', top: 20, left: 20 }}>{state.error}</p> : null}
    <button type="button" aria-label="Reveal Space handle" style={{
      position: 'absolute', left: -10000, top: 0, pointerEvents: 'auto',
    }} onFocus={event => { event.currentTarget.style.left = '12px'; }}
      onBlur={event => { event.currentTarget.style.left = '-10000px'; }}
      onClick={() => dispatch({ type: 'DOUBLE_TAP_CANVAS' })}>Reveal Space handle</button>
  </div>;
}
