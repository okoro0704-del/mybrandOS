import { createContext } from "react";

/** False while the Home feed is kept alive behind another APP destination: media pauses but is not unmounted. */
export const FeedVisibilityContext = createContext(true);
