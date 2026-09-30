/** Customer profile embedded on order queries (`customer:profiles!customer_id`). */
export function getCustomerFromOrder(order) {
  if (!order) return null;
  const row = order.customer ?? order.customer_profile ?? null;
  if (!row?.phone && !row?.full_name) return null;
  return row;
}

/** Ghana numbers → `tel:+233…` for mobile dialer. */
export function formatCustomerTelHref(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('233')) return `tel:+${digits}`;
  if (digits.startsWith('0')) return `tel:+233${digits.slice(1)}`;
  return `tel:+233${digits}`;
}
