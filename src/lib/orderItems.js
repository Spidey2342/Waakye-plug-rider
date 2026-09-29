/**
 * Customer checkout stores line items on `orders.items` (JSON array):
 * { id, name, price, category, quantity }
 */
export function parseOrderItems(order) {
  const raw = order?.items;
  if (raw == null) return [];

  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(list)) return [];

  return list
    .map((it, index) => ({
      key: it?.id ?? `line-${index}`,
      name: String(it?.name ?? 'Item').trim() || 'Item',
      quantity: Math.max(1, Number(it?.quantity) || 1),
      price: it?.price != null && !Number.isNaN(Number(it.price)) ? Number(it.price) : null,
      category: it?.category ? String(it.category) : null,
    }))
    .filter((it) => it.name);
}

export function summarizeOrderItems(items, { maxLines = 3 } = {}) {
  if (!items.length) return { lines: [], extraCount: 0, totalPieces: 0 };
  const totalPieces = items.reduce((sum, it) => sum + it.quantity, 0);
  const lines = items.slice(0, maxLines);
  const extraCount = Math.max(0, items.length - maxLines);
  return { lines, extraCount, totalPieces };
}
