import type { DestinationReadiness, LiveCapability } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { liveBroadcastOf, liveDestinationsOf } from "@mybrandos/integrations";

export function destinationReadiness(primitives: PrimitiveBindings, ownerId = ""): DestinationReadiness[] {
  return liveDestinationsOf(primitives.liveDestinations).list().map((provider) => {
    const connection = provider.connection(ownerId);
    return {
      destination: provider.destination,
      kind: connection.kind,
      connection: connection.connection,
      connected: connection.connected,
      ready: connection.ready && connection.connection === "READY",
      support: connection.support,
      detail: connection.detail,
      retryable: connection.retryable,
    };
  });
}

export function videoLiveCapability(primitives: PrimitiveBindings, ownerId = ""): LiveCapability {
  const health = liveBroadcastOf(primitives.liveBroadcast).health();
  const destinations = destinationReadiness(primitives, ownerId);
  if (health.available && health.bound) {
    return {
      id: "video.live",
      available: true,
      code: "ok",
      detail: health.detail,
      destinations,
    };
  }
  return {
    id: "video.live",
    available: false,
    code: "live_unavailable",
    detail: health.detail || "Live broadcasting is not configured for this environment.",
    destinations,
  };
}
