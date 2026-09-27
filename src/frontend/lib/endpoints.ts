/**
 * @fileoverview API paths that a test can hold the Worker to.
 *
 * Most islands build their path inline, which is fine right up until the path is
 * wrong: `FolderOrganiser` asked for `/api/library` (the route is
 * `/api/library/images`) and, because the read sat inside a `Promise.allSettled`
 * that substituted `[]` on failure, every folder in the workspace reported "0
 * images" instead of an error. Nothing caught it — a test that hits
 * `/api/library/images` directly passes whatever the client asks for, and the
 * SSR markup is identical either way.
 *
 * So the paths a screen cannot function without live here, and
 * `test/frontend-endpoints.test.ts` asserts the Hono routers actually answer
 * them. Add a path here when getting it wrong would be invisible; leave a
 * one-off inline.
 */

/** Images in the library, optionally scoped to one folder (`?folderId=`). */
export const LIBRARY_IMAGES_PATH = "library/images";

/** The folder tree. `?scope=` selects all / roots / one folder's children. */
export const LIBRARY_FOLDERS_PATH = "library/folders";

/** The curated reusable sources. */
export const ASSETS_PATH = "assets";

/** Effective folder settings, with the ancestor each value came from. */
export const folderSettingsPath = (folderId: string): string =>
  `${LIBRARY_FOLDERS_PATH}/${folderId}/settings`;

/** Place a copy of an asset's image into a folder. */
export const assetPlacePath = (assetId: string): string => `${ASSETS_PATH}/${assetId}/place`;

/** One turn of the folder agent conversation. */
export const AGENT_TURN_PATH = "agent/turn";
