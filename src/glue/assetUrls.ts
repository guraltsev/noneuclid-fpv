/**
 * Builds URLs for files served from the Vite public folder. The site is built with a relative base ("./"), so it works from any path: URLs are resolved against the page (document.baseURI), never against the module that asks.
 * publicUrl addresses the public root, publicAssetUrl addresses its assets/ subfolder, and legacyPublicAssetUrl its assets/_legacy/ subfolder. Leading slashes in the argument are ignored.
 */
/**
 * Returns the URL of a file relative to the public root, resolved against the page's address (so `?config=` queries and
 * the deployment path do not matter). Without a document (unit tests) it returns the path prefixed by the Vite base.
 */
export function publicUrl(path: string): string {
  const relative = path.replace(/^\/+/, "");
  if (typeof document === "undefined") {
    return `${import.meta.env.BASE_URL}${relative}`;
  }
  return new URL(relative, document.baseURI).href;
}

/** Returns the URL of a file under assets/ in the public folder. */
export function publicAssetUrl(path: string): string {
  return publicUrl(`assets/${path.replace(/^\/+/, "")}`);
}

/** Returns the URL of a file under assets/_legacy/ (older assets kept for compatibility). */
export function legacyPublicAssetUrl(path: string): string {
  return publicAssetUrl(`_legacy/${path.replace(/^\/+/, "")}`);
}
