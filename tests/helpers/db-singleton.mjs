/**
 * The api modules import a single shared db client. Tests build a fake and
 * install it here before invoking a handler.
 */
let current = null;

export function set(client) {
  current = client;
}

export function get() {
  if (!current) throw new Error('fake supabase not installed — call set() first');
  return current;
}
