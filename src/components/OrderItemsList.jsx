import { parseOrderItems } from '../lib/orderItems';

function ItemRow({ name, quantity, price, compact }) {
  return (
    <div className={`flex items-start justify-between gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
      <p className="font-medium text-gray-900 min-w-0 flex-1">
        <span className="text-[#7a1d1d] font-bold tabular-nums">{quantity}×</span>{' '}
        <span className="break-words">{name}</span>
      </p>
      {price != null && !compact && (
        <span className="shrink-0 text-gray-500 tabular-nums">GH₵{(price * quantity).toFixed(2)}</span>
      )}
    </div>
  );
}

/**
 * @param {{ order: object; title?: string; compact?: boolean; maxLines?: number; className?: string }} props
 */
export function OrderItemsList({
  order,
  title = 'What to buy',
  compact = false,
  maxLines,
  className = '',
}) {
  const items = parseOrderItems(order);

  if (!items.length) {
    return (
      <div className={`rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 ${className}`}>
        <p className="text-xs font-bold text-amber-900">{title}</p>
        <p className="text-xs text-amber-800/90 mt-0.5">
          Item list missing — call the vendor or support before paying.
        </p>
      </div>
    );
  }

  const visible = maxLines != null ? items.slice(0, maxLines) : items;
  const hiddenCount = maxLines != null ? Math.max(0, items.length - maxLines) : 0;

  return (
    <div className={className}>
      <p
        className={
          compact
            ? 'text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5'
            : 'text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2'
        }
      >
        {title}
      </p>
      <ul className={compact ? 'space-y-1.5' : 'space-y-2'}>
        {visible.map((it) => (
          <li key={it.key}>
            <ItemRow name={it.name} quantity={it.quantity} price={it.price} compact={compact} />
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <p className="text-xs text-gray-500 mt-1.5 font-medium">+ {hiddenCount} more item{hiddenCount === 1 ? '' : 's'}</p>
      )}
    </div>
  );
}
