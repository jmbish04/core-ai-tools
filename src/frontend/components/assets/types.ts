/**
 * @fileoverview Asset types, mirrored from `GET /api/assets` and
 * `GET /api/assets/:id/iterations`.
 */

/** An asset plus the picture it stands for. */
export interface AssetRow {
  id: string;
  name: string;
  libraryImageId: string;
  promotedFromImageId: string | null;
  description: string | null;
  usageInstructions: string | null;
  contextText: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  image: {
    id: string;
    publicId: string | null;
    deliveryUrl: string;
    title: string | null;
  };
}

/**
 * One image that descends from an asset. Flat by design: the API returns rows
 * carrying their folder and session, and grouping is the surface's job — a
 * timeline groups by folder, a run view groups by session.
 */
export interface AssetIteration {
  libraryImageId: string;
  publicId: string | null;
  deliveryUrl: string;
  folderId: string | null;
  sessionUuid: string | null;
  revisionId: string | null;
  revLabel: string | null;
  createdAt: string;
}

/**
 * Cloudflare Images URLs end in a named variant. Swap the last segment — never
 * append, which produces a 404 that looks like a missing image.
 */
export function thumbOf(deliveryUrl: string): string {
  return deliveryUrl.replace(/\/[^/]+$/, "/thumb");
}
