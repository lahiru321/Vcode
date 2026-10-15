const MAX_SLUG_LENGTH = 48;

/**
 * "My Shop (v2)" → "my-shop-v2". Accents are dropped; anything else non-alphanumeric is a dash.
 * Used for project slugs and workspace folder names, and by the renderer to preview them.
 */
export function slugify(name: string, fallback = 'project'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}
