/**
 * Shopping cart — localStorage-backed list of {course_id|lesson_id} entries.
 *
 * Pricing is never stored client-side: cart only carries the IDs. The
 * backend resolves prices + coupon at quote/upload time. This way a stale
 * cart from yesterday picks up today's price changes automatically.
 *
 * Subscribers (header badge, cart page) get notified through a tiny
 * pub/sub so they don't have to poll storage.
 */

const KEY = "ondemand.cart.v1";

export type CartEntry = {
  course_id?: string;
  course_slug?: string;     // kept so we can show name without a roundtrip
  lesson_id?: string;
  lesson_title?: string;
  course_title?: string;
  unit_price_baht?: number; // optimistic — UI only; backend re-prices
  cover_image_key?: string | null;
};

type Listener = (items: CartEntry[]) => void;
const listeners = new Set<Listener>();

function readRaw(): CartEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items: CartEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((fn) => fn(items));
}

function sameEntry(a: CartEntry, b: CartEntry): boolean {
  if (a.course_id && b.course_id) return a.course_id === b.course_id;
  if (a.lesson_id && b.lesson_id) return a.lesson_id === b.lesson_id;
  return false;
}

export function getCart(): CartEntry[] {
  return readRaw();
}

export function cartCount(): number {
  return readRaw().length;
}

/**
 * Add an entry. If the item is already in the cart this is a no-op (we
 * sell each course/lesson once per user — there's no "quantity").
 */
export function addToCart(entry: CartEntry): { added: boolean; reason?: string } {
  if (!entry.course_id && !entry.lesson_id) {
    return { added: false, reason: "missing id" };
  }
  const items = readRaw();
  if (items.some((i) => sameEntry(i, entry))) {
    return { added: false, reason: "duplicate" };
  }
  items.push(entry);
  writeRaw(items);
  return { added: true };
}

export function removeFromCart(idx: number) {
  const items = readRaw();
  if (idx < 0 || idx >= items.length) return;
  items.splice(idx, 1);
  writeRaw(items);
}

export function clearCart() {
  writeRaw([]);
}

export function isInCart(opts: { course_id?: string; lesson_id?: string }): boolean {
  if (!opts.course_id && !opts.lesson_id) return false;
  return readRaw().some((i) =>
    (opts.course_id && i.course_id === opts.course_id) ||
    (opts.lesson_id && i.lesson_id === opts.lesson_id)
  );
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** API-shape converter for posting to /orders/quote etc. */
export function toApiItems(items: CartEntry[]) {
  return items.map((i) => ({
    course_id: i.course_id,
    lesson_id: i.lesson_id,
  }));
}
