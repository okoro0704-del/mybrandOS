import test from 'node:test';
import assert from 'node:assert/strict';
import * as creator from '../../../packages/shared/src/space-runtime.ts';
import * as lifeos from '../../../../LifeOS/apps/lifeos-web/src/lib/space-runtime.ts';

// One behavioral definition; no shared production runtime or fixture tenants.
const registry: creator.SpaceDefinition[] = ['fixture.alpha', 'fixture.beta'].map(id => ({
  id, owner: id, defaultExperienceId: 'APP',
  experiences: ['APP', 'TV', 'RADIO', 'DIGIPEDIA', 'NEWS'].map(id => ({
    id, title: id, type: id, lifecyclePolicy: 'retained', offlinePolicy: 'cached',
  })),
}));
for (const [name, api] of [['mybrandOS', creator], ['LifeOS', lifeos]] as const) {
  const initial = () => api.createSpaceRuntime(registry[0]);
  const reduce = (s: creator.SpaceRuntime, e: creator.SpaceEvent) => api.reduceSpace(s, e, registry);
  const summon = (s = initial()) => reduce(reduce(s, { type: 'DOUBLE_TAP_CANVAS' }), { type: 'TAP_HANDLE' });
  const activate = (s: creator.SpaceRuntime) => reduce(s, { type: 'ACTIVATED', transitionId: s.pending!.id });

  test(`${name}: reveal, pin, timeout and independent persistent UI`, () => {
    let s = initial();
    assert.equal(s.presentationState, 'GLASS');
    s = reduce(s, { type: 'DOUBLE_TAP_CANVAS' });
    assert.equal(s.presentationState, 'REVEAL_HANDLE');
    assert.equal(reduce(s, { type: 'HANDLE_TIMEOUT' }).presentationState, 'GLASS');
    s = reduce(s, { type: 'DOUBLE_TAP_HANDLE' });
    assert.equal(s.handlePinned, true);
    assert.equal(s.persistentUI, false);
    assert.strictEqual(reduce(s, { type: 'HANDLE_TIMEOUT' }), s);
    s = reduce(s, { type: 'TAP_HANDLE' });
    s = reduce(s, { type: 'KEEP_UI' });
    assert.equal(s.persistentUI, true);
    s = reduce(s, { type: 'HIDE_UI' });
    assert.equal(s.presentationState, 'GLASS');
    assert.equal(s.persistentUI, false);
    assert.equal(s.handlePinned, true);
    s = reduce(s, { type: 'DOUBLE_TAP_HANDLE' });
    assert.equal(s.handlePinned, false);
    assert.equal(reduce(s, { type: 'HANDLE_TIMEOUT' }).presentationState, 'GLASS');
    s = reduce(s, { type: 'TAP_HANDLE' });
    s = reduce(s, { type: 'KEEP_UI' });
    assert.equal(s.handlePinned, false);
  });
  for (const from of registry[0].experiences) for (const to of registry[0].experiences) {
    test(`${name}: Switch ${from.id} -> ${to.id} preserves Space`, () => {
      const s = summon({ ...initial(), currentExperienceId: from.id });
      const switching = reduce(s, { type: 'SELECT_EXPERIENCE', experienceId: to.id });
      if (from.id === to.id) return assert.strictEqual(switching, s);
      assert.equal(switching.presentationState, 'SWITCHING');
      assert.equal(switching.currentExperienceId, from.id);
      const next = activate(switching);
      assert.equal(next.presentationState, 'GLASS');
      assert.equal(next.currentSpaceId, s.currentSpaceId);
      assert.equal(next.currentExperienceId, to.id);
    });
  }
  for (const experience of registry[0].experiences) test(`${name}: interaction preserves ${experience.id}`, () => {
    let s = summon({ ...initial(), currentExperienceId: experience.id });
    for (const persistentUI of [false, true]) {
      s = reduce({ ...s, presentationState: 'SUMMONED_UI', persistentUI }, { type: 'OPEN_INTERACTIONS' });
      assert.equal(s.presentationState, 'INTERACTION');
      assert.equal(s.currentExperienceId, experience.id);
      s = reduce(s, { type: 'CLOSE_INTERACTIONS' });
      assert.equal(s.presentationState, persistentUI ? 'SUMMONED_UI' : 'GLASS');
      assert.equal(s.currentExperienceId, experience.id);
    }
  });
  test(`${name}: Revolve restores last experience and independent preferences`, () => {
    let s = { ...summon(), currentExperienceId: 'TV', handlePinned: true, persistentUI: false };
    s = reduce(s, { type: 'REVOLVE', spaceId: registry[1].id });
    assert.equal(s.presentationState, 'REVOLVING');
    assert.equal(s.currentSpaceId, registry[0].id);
    s = activate(s);
    assert.equal(s.currentSpaceId, registry[1].id);
    assert.equal(s.currentExperienceId, 'APP');
    assert.equal(s.handlePinned, false);
    s = summon(s);
    s = reduce(s, { type: 'REVOLVE', spaceId: registry[0].id });
    s = activate(s);
    assert.equal(s.currentSpaceId, registry[0].id);
    assert.equal(s.currentExperienceId, 'TV');
    assert.equal(s.handlePinned, true);
    assert.equal(s.persistentUI, false);
  });
  test(`${name}: invalid targets, failed and stale activation are safe`, () => {
    const s = summon();
    for (const id of ['SPACE', 'missing']) assert.strictEqual(reduce(s, { type: 'SELECT_EXPERIENCE', experienceId: id }), s);
    for (const id of [s.currentSpaceId, 'missing']) assert.strictEqual(reduce(s, { type: 'REVOLVE', spaceId: id }), s);
    for (const event of [{ type: 'SELECT_EXPERIENCE', experienceId: 'TV' }, { type: 'REVOLVE', spaceId: registry[1].id }] as const) {
      const pending = reduce(s, event);
      assert.strictEqual(reduce(pending, { type: 'ACTIVATED', transitionId: 99 }), pending);
      const failed = reduce(pending, { type: 'ACTIVATION_FAILED', transitionId: pending.pending!.id });
      assert.equal(failed.currentSpaceId, s.currentSpaceId);
      assert.equal(failed.currentExperienceId, s.currentExperienceId);
      assert.equal(failed.presentationState, 'SUMMONED_UI');
      assert.strictEqual(reduce(failed, { type: 'ACTIVATED', transitionId: pending.pending!.id }), failed);
    }
  });
  test(`${name}: unlisted state/event pairs are no-ops`, () => {
    const allowed: Record<string, string[]> = {
      GLASS: ['DOUBLE_TAP_CANVAS'],
      REVEAL_HANDLE: ['TAP_HANDLE', 'DOUBLE_TAP_HANDLE', 'HANDLE_TIMEOUT'],
      SUMMONED_UI: ['KEEP_UI', 'HIDE_UI', 'OPEN_INTERACTIONS', 'SELECT_EXPERIENCE', 'REVOLVE'],
      INTERACTION: ['CLOSE_INTERACTIONS'], SWITCHING: [], REVOLVING: [],
    };
    const events: creator.SpaceEvent[] = [
      ...['DOUBLE_TAP_CANVAS','TAP_HANDLE','DOUBLE_TAP_HANDLE','HANDLE_TIMEOUT','KEEP_UI','HIDE_UI','OPEN_INTERACTIONS','CLOSE_INTERACTIONS'].map(type => ({ type } as creator.SpaceEvent)),
      { type: 'SELECT_EXPERIENCE', experienceId: 'TV' }, { type: 'REVOLVE', spaceId: registry[1].id },
      { type: 'ACTIVATED', transitionId: 1 }, { type: 'ACTIVATION_FAILED', transitionId: 1 },
    ];
    for (const presentationState of api.PRESENTATION_STATES) for (const event of events) {
      if (allowed[presentationState].includes(event.type)) continue;
      const s = { ...initial(), presentationState };
      assert.strictEqual(reduce(s, event), s, `${presentationState}/${event.type}`);
    }
  });
  test(`${name}: versioned allowlisted persistence and Space isolation`, () => {
    const state = { ...initial(), currentExperienceId: 'RADIO', handlePinned: true, secret: 'must-not-persist' };
    const raw = api.serializeSpace(state);
    assert.equal(raw.includes('secret'), false);
    assert.equal(raw.includes('must-not-persist'), false);
    const restored = api.createSpaceRuntime(registry[0], api.restoreSpace(raw, registry[0]));
    assert.equal(restored.currentExperienceId, 'RADIO');
    assert.equal(restored.handlePinned, true);
    assert.equal(api.restoreSpace(raw, registry[1]), undefined);
    for (const invalid of ['{', 'null', '{"version":99}', raw.replace('RADIO','SPACE'), raw.replace('true','"true"')]) {
      assert.equal(api.restoreSpace(invalid, registry[0]), undefined);
    }
  });
  test(`${name}: offline capabilities do not invent identity or transport`, () => {
    const caps = api.offlineSpaceCapabilities(false, false);
    assert.equal(caps.cachedMedia, 'UNAVAILABLE');
    assert.equal(caps.offlineIdentity, 'NOT_IMPLEMENTED');
    assert.equal(caps.callingTransport, 'NOT_IMPLEMENTED');
  });
}
