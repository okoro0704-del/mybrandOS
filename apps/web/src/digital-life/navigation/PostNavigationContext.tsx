import { createContext, useContext } from "react";

/**
 * Feed → shell channel: while a post is moving between slides, the shell hides the bottom
 * navigation so the post's interaction controls can take the bottom bar position.
 */
export type PostNavigationApi = {
  setPostNavigating: (navigating: boolean) => void;
};

const noop: PostNavigationApi = { setPostNavigating: () => undefined };

export const PostNavigationContext = createContext<PostNavigationApi>(noop);

export function usePostNavigation(): PostNavigationApi {
  return useContext(PostNavigationContext);
}
