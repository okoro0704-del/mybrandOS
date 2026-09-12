/** Creator/admin navigation inside mybrandOS. Public branded nav is configured in `brand.ts`. */
export const PRIMARY_NAV = [
  { id: "home", label: "Home", path: "/", icon: "home" },
  { id: "create", label: "Create", path: "/create", icon: "create" },
  { id: "publish", label: "Publish", path: "/publish", icon: "publish" },
  { id: "assets", label: "Assets", path: "/assets", icon: "assets" },
  { id: "live", label: "Live", path: "/live", icon: "live" },
  { id: "recording", label: "Recording", path: "/recording", icon: "recording" },
  { id: "production", label: "Production", path: "/production", icon: "production" },
  { id: "distribute", label: "Distribute", path: "/distribution", icon: "distribute" },
] as const;

export const SECONDARY_NAV = [
  { id: "audience", label: "Audience", path: "/audience", icon: "audience" },
  { id: "commerce", label: "Commerce", path: "/commerce", icon: "commerce" },
  { id: "brand", label: "Brand", path: "/brand", icon: "brand" },
  { id: "website", label: "Website", path: "/website", icon: "space" },
  { id: "system", label: "Settings", path: "/system", icon: "settings" },
] as const;

export const OWNER_SURFACE_NAV = [
  { id: "workstation", label: "Workstation", path: "/", detail: "Operate your Digital Life" },
  { id: "digital_life", label: "My Digital Life", path: "/brand/preview", detail: "Preview the public experience" },
  { id: "website", label: "Website", path: "/website", detail: "Official information surface" },
] as const;

export const DOCK_NAV = [
  { id: "home", label: "Home", path: "/", icon: "home" },
  { id: "create", label: "Create", path: "/create", icon: "create" },
  { id: "publish", label: "Publish", path: "/publish", icon: "publish" },
  { id: "assets", label: "Assets", path: "/assets", icon: "assets" },
] as const;

export const COMMAND_CENTER_PATH = "/command-center";
export const IMPORT_PATH = "/import";
export const PROCESSING_PATH = "/processing";
export const LIVE_CENTER_PATH = "/live";
export const PRODUCTION_PATH = "/production";
export const RECORDING_PATH = "/recording";

export type PrimaryNavId = (typeof PRIMARY_NAV)[number]["id"];
export type SecondaryNavId = (typeof SECONDARY_NAV)[number]["id"];
