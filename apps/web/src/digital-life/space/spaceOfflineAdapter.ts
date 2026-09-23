import { restoreSpace, type OfflineSpaceAdapter, type SpaceDefinition } from '@mybrandos/shared';
import { getOfflineMediaBlob, getStationPlaybackState, listOfflinePublications } from '../offline/offlineKernel';

/** Existing Offline Kernel only. No new DB, identity, or transport subsystem. */
export function createSpaceOfflineAdapter(space: SpaceDefinition): OfflineSpaceAdapter {
  return {
    async restoreCachedSpace() {
      try {
        const saved = restoreSpace(localStorage.getItem('space-contract-v1:' + space.id), space);
        return saved ? { status: 'SUPPORTED', value: saved } : { status: 'UNAVAILABLE', reason: 'No valid saved Space preferences' };
      } catch { return { status: 'UNAVAILABLE', reason: 'Storage unavailable' }; }
    },
    async restoreCachedExperience(id) {
      if (!space.experiences.some(entry => entry.id === id)) return { status: 'UNSUPPORTED', reason: 'Experience not registered' };
      if (id !== 'TV' && id !== 'RADIO') return { status: 'NOT_IMPLEMENTED', reason: 'No safe cursor adapter for this experience' };
      try {
        const cursor = await getStationPlaybackState(space.owner, id);
        return cursor ? { status: 'SUPPORTED', value: cursor } : { status: 'UNAVAILABLE', reason: 'No cached playback cursor' };
      } catch { return { status: 'UNAVAILABLE', reason: 'Offline Kernel unavailable' }; }
    },
    async getAvailableMedia() {
      try {
        const rows = (await listOfflinePublications()).filter(row => row.slug === space.owner);
        const ids: string[] = [];
        for (const row of rows) if (await getOfflineMediaBlob(row.id)) ids.push(row.id);
        return ids.length ? { status: 'SUPPORTED', value: ids } : { status: 'UNAVAILABLE', reason: 'No verified local media bytes for this Space' };
      } catch { return { status: 'UNAVAILABLE', reason: 'Offline Kernel unavailable' }; }
    },
    getConnectivityState: () => navigator.onLine ? 'online' : 'offline',
    getTransportCapabilities: () => ({ status: 'NOT_IMPLEMENTED', reason: 'Offline calling transport is not established' }),
    validateOfflineSession: () => ({ status: 'NOT_IMPLEMENTED', reason: 'Cached content is not offline identity validation' }),
  };
}
