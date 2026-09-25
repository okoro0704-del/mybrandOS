import test from 'node:test';
import assert from 'node:assert/strict';
import { canConsumePublicCapability, trustStateFor } from '../../../apps/web/src/digital-life/experience/trustBoundary.ts';
test('public mybrandOS consumption is guest-safe and sensitive capability classes are not', () => {
  assert.equal(trustStateFor(), 'GUEST');
  assert.equal(trustStateFor('TD-ONE'), 'IDENTIFIED');
  assert.equal(trustStateFor('TD-ONE', true), 'STEP_UP_VERIFIED');
  assert.equal(canConsumePublicCapability('PUBLIC'), true);
  assert.equal(canConsumePublicCapability('IDENTITY_REQUIRED'), false);
  assert.equal(canConsumePublicCapability('STEP_UP_REQUIRED'), false);
});
