import {

  LocalDataZoneAdapter,

  RemoteDataZoneAdapter,

  type IDataZoneProvider,

} from "./datazone.js";

import {

  ApplicationDistributionAdapter,

  LocalDistributionAdapter,

  LocalMasterDistributorAdapter,

  RemoteMasterDistributorAdapter,

  type IDistributionProvider,

  type IMasterDistributorProvider,

} from "./distribution.js";

import { LocalElfComAdapter, RemoteElfComAdapter, type IElfComProvider } from "./elfcom.js";

import { LocalFundzManAdapter, RemoteFundzManAdapter, type IFundzManProvider } from "./fundzman.js";

import { LocalTrustIdAdapter, RemoteTrustIdAdapter, type ITrustIdProvider } from "./trust-id.js";

import { createAiProvider, type IAiProvider } from "./ai.js";

import { createPlatformJobsAdapter, type IPlatformJobsProvider } from "./jobs.js";

import { createLiveBroadcastProvider, type ILiveBroadcastProvider } from "./live.js";

import { createLiveDestinationRegistry, type ILiveDestinationRegistry } from "./destinations.js";

import { PrimitiveError } from "./errors.js";



export type PrimitiveBindings = {

  trustId: ITrustIdProvider;

  dataZone: IDataZoneProvider;

  elfCom: IElfComProvider;

  platformJobs: IPlatformJobsProvider;

  masterDistributor: IMasterDistributorProvider;

  fundzMan: IFundzManProvider;

  /** Application content distribution — not a primitive. */

  distribution: IDistributionProvider;

  /** AI provider capability — not a primitive. */

  ai: IAiProvider;

  /** Live broadcasting provider — not a primitive. */

  liveBroadcast?: ILiveBroadcastProvider;

  /** Live destination delivery — not a primitive. */

  liveDestinations?: ILiveDestinationRegistry;

};



export type IntegrationConfig = {

  nodeEnv?: string;

  primitivesMode: "local" | "remote";

  trustIdApi: string;

  dataZoneApiUrl: string;

  dataZoneApiKey: string;

  dataZoneBound: boolean;

  elfcomMode: "unbound" | "http";

  elfcomBaseUrl: string;

  elfcomToken?: string;

  platformJobsUrl?: string;

  platformJobsToken?: string;

  fundzmanUrl?: string;

  distributorUrl: string;

  aiProvider?: string;

  aiApiKey?: string;

  aiModel?: string;

  liveBroadcastUrl?: string;

  liveBroadcastToken?: string;

};



export function assertProductionPrimitiveConfig(config: IntegrationConfig) {

  const production = (config.nodeEnv ?? process.env.NODE_ENV) === "production";

  if (!production) return;

  if (config.primitivesMode !== "remote") {

    throw new PrimitiveError(

      "trust-id",

      "NOT_CONFIGURED",

      "PRIMITIVES_MODE=local is not allowed in production.",

    );

  }

  if (!config.trustIdApi) {

    throw new PrimitiveError("trust-id", "NOT_CONFIGURED", "TRUSTID_API is required in production.");

  }

  if (!config.dataZoneBound || !config.dataZoneApiKey || !config.dataZoneApiUrl) {

    throw new PrimitiveError(

      "sovereign-drive",

      "NOT_CONFIGURED",

      "Production requires a bound DataZone/Sovereign Drive (DATAZONE_BOUND + DATAZONE_API_KEY).",

    );

  }

  if (!config.platformJobsUrl) {

    throw new PrimitiveError(

      "platform-jobs",

      "NOT_CONFIGURED",

      "Production requires PLATFORM_JOBS_URL. mybrandOS must not queue work locally.",

    );

  }

}



export function createPrimitiveContainer(config: IntegrationConfig): PrimitiveBindings {

  assertProductionPrimitiveConfig(config);

  const remote = config.primitivesMode === "remote";

  const production = (config.nodeEnv ?? process.env.NODE_ENV) === "production";



  if (production && !remote) {

    throw new PrimitiveError("trust-id", "NOT_CONFIGURED", "Production cannot use local primitive adapters.");

  }



  const platformJobs = createPlatformJobsAdapter({

    mode: remote ? "remote" : "local",

    url: config.platformJobsUrl,

    token: config.platformJobsToken,

  });



  const dataZone =

    remote && config.dataZoneBound && config.dataZoneApiKey

      ? new RemoteDataZoneAdapter(config.dataZoneApiUrl, config.dataZoneApiKey)

      : new LocalDataZoneAdapter();



  if (production && dataZone instanceof LocalDataZoneAdapter) {

    throw new PrimitiveError("sovereign-drive", "DATAZONE_UNAVAILABLE", "Production cannot use local DataZone storage.");

  }



  return {

    trustId: remote ? new RemoteTrustIdAdapter(config.trustIdApi) : new LocalTrustIdAdapter(),

    dataZone,

    elfCom:

      remote && config.elfcomMode === "http"

        ? new RemoteElfComAdapter(config.elfcomBaseUrl, config.elfcomToken)

        : new LocalElfComAdapter(),

    platformJobs,

    masterDistributor:

      remote && config.distributorUrl

        ? new RemoteMasterDistributorAdapter(config.distributorUrl)

        : new LocalMasterDistributorAdapter(),

    fundzMan:

      remote && config.fundzmanUrl

        ? new RemoteFundzManAdapter(config.fundzmanUrl)

        : new LocalFundzManAdapter(),

    distribution: remote ? new ApplicationDistributionAdapter(platformJobs) : new LocalDistributionAdapter(),

    ai: createAiProvider({

      provider: config.aiProvider ?? "unbound",

      apiKey: config.aiApiKey,

      model: config.aiModel,

    }),

    liveBroadcast: createLiveBroadcastProvider({

      url: config.liveBroadcastUrl,

      token: config.liveBroadcastToken,

    }),

    liveDestinations: createLiveDestinationRegistry(),

  };

}

