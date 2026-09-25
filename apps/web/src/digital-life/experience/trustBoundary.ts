/** Consumption does not require identity. Authority does. */
export const TRUST_STATES = ['GUEST', 'IDENTIFIED', 'STEP_UP_VERIFIED'] as const;
export type TrustState = typeof TRUST_STATES[number];
export type SpaceCapabilityAccess = 'PUBLIC' | 'IDENTITY_REQUIRED' | 'STEP_UP_REQUIRED';
export const SPACE_CAPABILITY_ACCESS = {
  'space.media': 'PUBLIC', 'space.tv': 'PUBLIC', 'space.radio': 'PUBLIC',
  'space.digipedia.public': 'PUBLIC', 'space.news.public': 'PUBLIC',
  'space.personal.sync': 'IDENTITY_REQUIRED', 'space.private.data': 'IDENTITY_REQUIRED',
  'space.wallet.withdraw': 'STEP_UP_REQUIRED', 'space.studio.publish': 'IDENTITY_REQUIRED',
} as const satisfies Record<string, SpaceCapabilityAccess>;
export function trustStateFor(trustId?: string | null, stepUp = false): TrustState { return stepUp ? 'STEP_UP_VERIFIED' : trustId ? 'IDENTIFIED' : 'GUEST'; }
export function canConsumePublicCapability(access: SpaceCapabilityAccess): boolean { return access === 'PUBLIC'; }
