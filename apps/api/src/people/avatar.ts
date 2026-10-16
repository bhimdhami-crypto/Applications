/**
 * A drawn avatar for people without an uploaded photo: initials on a colour picked from the
 * person's id, so the same person always gets the same picture. Plain SVG with no scripts.
 */
const COLOURS = ['#B84700', '#1F5FAD', '#2E7D4F', '#6B3FA0', '#A3324A', '#1F7A7A', '#5A5A5A', '#8A5A00'];

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function avatarSvg(id: string, firstName: string, lastName: string) {
  const h = [...id].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 11);
  const bg = COLOURS[h % COLOURS.length];
  const initials = escape(`${[...firstName][0] ?? ''}${[...lastName][0] ?? ''}`.toUpperCase());
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img"><rect width="96" height="96" rx="48" fill="${bg}"/><text x="48" y="50" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="36" font-weight="600" fill="#FFFFFF">${initials}</text></svg>`;
}
