/**
 * Builds URLs for files served from the Vite public folder, honoring the deployment base path (import.meta.env.BASE_URL) so the app works when hosted under a sub-path.
 * publicUrl addresses the public root, publicAssetUrl addresses its assets/ subfolder, and legacyPublicAssetUrl its assets/_legacy/ subfolder. Leading slashes in the argument are ignored.
 */
/** Returns the URL of a file relative to the public root, prefixed by the Vite base path. */
export function publicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

/** Returns the URL of a file under assets/ in the public folder. */
export function publicAssetUrl(path: string): string {
  return publicUrl(`assets/${path.replace(/^\/+/, "")}`);
}

/** Returns the URL of a file under assets/_legacy/ (older assets kept for compatibility). */
export function legacyPublicAssetUrl(path: string): string {
  return publicAssetUrl(`_legacy/${path.replace(/^\/+/, "")}`);
}
