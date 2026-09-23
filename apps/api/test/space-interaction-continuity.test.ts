import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_MEDIA_SURFACES, initialCreatorSpaceModel, reduceCreatorSpace } from '../../../packages/shared/src/creator-space.ts';

for (const experience of CREATOR_MEDIA_SURFACES) {
  test(`interactions and comments preserve ${experience}`, () => {
    let model = initialCreatorSpaceModel(experience);
    for (const action of [
      { type: 'LAUNCH', target: 'INTERACTIONS' },
      { type: 'OPEN_COMMENTS' },
      { type: 'CLOSE_COMMENTS' },
      { type: 'DISMISS_INTERACTION' },
    ] as const) {
      model = reduceCreatorSpace(model, action);
      assert.equal(model.surface, experience);
    }
  });
}
