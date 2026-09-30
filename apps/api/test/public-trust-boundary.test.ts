import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canConsumePublicCapability, trustStateFor } from '../../../apps/web/src/digital-life/experience/trustBoundary.ts';
test('public mybrandOS consumption is guest-safe and sensitive capability classes are not', () => {
  assert.equal(trustStateFor(), 'GUEST');
  assert.equal(trustStateFor('TD-ONE'), 'IDENTIFIED');
  assert.equal(trustStateFor('TD-ONE', true), 'STEP_UP_VERIFIED');
  assert.equal(canConsumePublicCapability('PUBLIC'), true);
  assert.equal(canConsumePublicCapability('IDENTITY_REQUIRED'), false);
  assert.equal(canConsumePublicCapability('STEP_UP_REQUIRED'), false);
  const app = readFileSync(new URL('../../../apps/web/src/App.tsx', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../src/static-web.ts', import.meta.url), 'utf8');
  const enter = readFileSync(new URL('../../../apps/web/src/pages/Enter.tsx', import.meta.url), 'utf8');
  assert.match(app, /PublicExperiencePage/);
  assert.match(gate, /surface !== "workstation"/);
  assert.doesNotMatch(enter, /Boolean\(slug\)/);
  assert.match(enter, /Continue without signing in/);
});
