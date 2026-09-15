import { digitalLifePath, resolveDigitalLifeRequest, studioPath } from "@mybrandos/shared";
import { Link, NavLink, type LinkProps, type NavLinkProps, type NavigateOptions, type To, useNavigate } from "react-router-dom";
import { forwardRef, useCallback } from "react";

/** Workstation navigation and API-supplied public links use the canonical resolver. */
export function appPath(path: string): string {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  if (/^(https?:|mailto:|tel:|#)/.test(path)) return path;
  if (path.startsWith("/u/")) {
    const context = resolveDigitalLifeRequest(hostname, path);
    if (context.slug && context.surface !== "workstation") return digitalLifePath({ surface: context.surface, slug: context.slug, hostname,
      path: (context.surface === "website" ? context.rest.replace(/^website\/?/, "") : context.rest) + (path.match(/[?#].*$/)?.[0] ?? "") });
  }
  return studioPath(path, hostname);
}
function destination(to: To): To { return typeof to === "string" ? appPath(to) : { ...to, pathname: to.pathname ? appPath(to.pathname) : undefined }; }
export function useAppNavigate() {
  const navigate = useNavigate();
  return useCallback((to: To | number, opts?: NavigateOptions) => typeof to === "number" ? navigate(to) : navigate(destination(to), opts), [navigate]);
}
export const AppLink = forwardRef<HTMLAnchorElement, LinkProps>(function AppLink({ to, ...rest }, ref) {
  return <Link ref={ref} to={destination(to)} {...rest} />;
});
export const AppNavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function AppNavLink({ to, ...rest }, ref) {
  return <NavLink ref={ref} to={destination(to)} {...rest} />;
});
