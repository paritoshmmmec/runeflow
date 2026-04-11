/**
 * Shared utilities for runeflow init and template generation.
 */

/**
 * Standard slugification for names and identifiers.
 * Converts to lowercase, replaces non-alphanumeric with dashes, and trims dashes.
 * @param {string} str
 * @returns {string}
 */
export function slugify(str) {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
