/** Canonical order status display labels — keep in sync across vendor / rider / customer apps. */
export const ORDER_STATUS_LABELS = {
  available: 'Looking for a rider',
  rider_assigned: 'Rider assigned',
  picked_up: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function getStatusLabel(status) {
  if (!status) return 'Active order';
  if (Object.prototype.hasOwnProperty.call(ORDER_STATUS_LABELS, status)) {
    return ORDER_STATUS_LABELS[status];
  }
  if (status === 'ready' || status === 'pending' || status === 'accepted' || status === 'preparing') {
    return ORDER_STATUS_LABELS.available;
  }
  return 'Active order';
}
