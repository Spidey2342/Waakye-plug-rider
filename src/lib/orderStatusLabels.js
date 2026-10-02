/**
 * Canonical display labels for order status values.
 * 
 * These labels unify how order statuses appear across the rider app
 * (history screens, list badges, alerts, notifications, etc.).
 * 
 * NOTE: ActiveOrderScreen uses operational STAGES ("Heading to Vendor",
 * "At Vendor", etc.) for the rider workflow stepper — those are intentionally
 * separate and should not be changed. This helper is for status badges/chips
 * that show the raw database status.
 */

const STATUS_LABELS = {
  available: 'Looking for a rider',
  rider_assigned: 'Rider assigned',
  picked_up: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/**
 * Returns the canonical display label for an order status.
 * 
 * @param {string} status - The order status from the database
 * @returns {string} The human-readable label, or the original status if unknown
 * 
 * @example
 * orderStatusLabel('available') // => 'Looking for a rider'
 * orderStatusLabel('picked_up') // => 'On the way'
 */
export function orderStatusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Returns all available status labels as an object.
 * Useful for building dropdowns, filters, or documentation.
 * 
 * @returns {Object} Map of status codes to display labels
 */
export function getAllStatusLabels() {
  return { ...STATUS_LABELS };
}
