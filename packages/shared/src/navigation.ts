/** Creator/admin navigation inside mybrandOS. Public branded nav is configured in `brand.ts`. */
export const PRIMARY_NAV = [
  { id: "home", label: "Home", path: "/", icon: "home" },
  { id: "assets", label: "Assets", path: "/assets", icon: "assets" },
  { id: "create", label: "Create", path: "/create", icon: "create" },
  { id: "live", label: "Live", path: "/live", icon: "live" },
  { id: "production", label: "Production", path: "/production", icon: "production" },
  { id: "distribute", label: "Distribute", path: "/distribution", icon: "distribute" },
] as const;

export const SECONDARY_NAV = [
  { id: "audience", label: "Audience", path: "/audience", icon: "audience" },
  { id: "commerce", label: "Commerce", path: "/commerce", icon: "commerce" },
  { id: "brand", label: "Brand", path: "/brand", icon: "brand" },
  { id: "system", label: "Settings", path: "/system", icon: "settings" },
] as const;

export const DOCK_NAV = [
  { id: "home", label: "Home", path: "/", icon: "home" },
  { id: "assets", label: "Assets", path: "/assets", icon: "assets" },
  { id: "create", label: "Create", path: "/create", icon: "create" },
  { id: "live", label: "Live", path: "/live", icon: "live" },
] as const;

export const COMMAND_CENTER_PATH = "/command-center";
export const IMPORT_PATH = "/import";
export const PROCESSING_PATH = "/processing";
export const LIVE_CENTER_PATH = "/live";
export const PRODUCTION_PATH = "/production";

export type PrimaryNavId = (typeof PRIMARY_NAV)[number]["id"];
export type SecondaryNavId = (typeof SECONDARY_NAV)[number]["id"];
