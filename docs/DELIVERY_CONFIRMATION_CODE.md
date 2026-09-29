# 4-digit delivery confirmation code (customer + rider)

Cross-app feature: every **delivery** order gets a **4-digit code** so the customer and rider can confirm the **same order** at the **right dropoff**.

| App | Repo | Shipped in (example) |
|---|---|---|
| **Customer** | [Waakye-Plug2](https://github.com/Spidey2342/Waakye-Plug2) | `8cc4d06` — generate on checkout, show in UI |
| **Rider** | [Waakye-plug-rider](https://github.com/Spidey2342/Waakye-plug-rider) (this repo) | `d23ce9a` — display on active order, verify at delivery |
| **Database** | **Customer repo** `schema/migrations/20260929_orders_delivery_code.sql` | Apply on `verncapitxzsgcughvil` |
| **Edge function** | `supabase/functions/verify-delivery/` (this repo) | Redeploy after SQL |

---

## Product flow

1. Customer places order → `delivery_code` + `delivery_code_hash` on `orders` (customer app + DB trigger).
2. Customer sees code in **Waakye-Plug2** (Order details / My Orders).
3. Rider sees the **same code** on **Active order** (`ActiveOrderScreen.jsx`).
4. At dropoff, rider enters the code → **`verify-delivery`** → `delivered`.

Full write-up (schema, file list, ops):  
[Waakye-Plug2/docs/DELIVERY_CONFIRMATION_CODE.md](https://github.com/Spidey2342/Waakye-Plug2/blob/main/docs/DELIVERY_CONFIRMATION_CODE.md)

---

## Rider repo changes (`d23ce9a`)

| File | Role |
|---|---|
| `src/components/screens/ActiveOrderScreen.jsx` | Shows code; “Confirm delivery code” sheet + input |
| `src/lib/ordersApi.js` | `verifyDelivery(orderId, code)` → edge function |
| `supabase/functions/verify-delivery/index.ts` | bcrypt verify + mark delivered; rider id ownership fix |
| `supabase/migrations/20260929_orders_delivery_code.sql` | Mirror of customer migration (apply once in Supabase) |

---

## Ops checklist

- [ ] Run SQL from customer or rider `20260929_orders_delivery_code.sql` on production
- [ ] Redeploy rider Vercel + **`verify-delivery`** function
- [ ] Ensure customer app is deployed (`8cc4d06` or later)

See also [docs/OPERATIONS.md](OPERATIONS.md), [docs/ARCHITECTURE.md](ARCHITECTURE.md).
