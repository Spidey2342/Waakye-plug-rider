-- Mirror of Waakye-Plug2 schema/migrations/20260929_orders_delivery_code.sql
-- Apply once on verncapitxzsgcughvil (customer repo is schema source of truth).

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists delivery_code text;

comment on column public.orders.delivery_code is
  '4-digit code customer shows rider at dropoff. Generated at insert if omitted.';

alter table public.orders
  drop constraint if exists orders_delivery_code_format;

alter table public.orders
  add constraint orders_delivery_code_format
  check (delivery_code is null or delivery_code ~ '^\d{4}$');

create or replace function public.orders_set_delivery_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.delivery_mode is distinct from 'delivery' then
    return new;
  end if;

  if new.delivery_code is null or btrim(new.delivery_code) = '' then
    new.delivery_code := lpad((floor(random() * 10000))::int::text, 4, '0');
  end if;

  if new.delivery_code !~ '^\d{4}$' then
    raise exception 'delivery_code must be exactly 4 digits';
  end if;

  if new.delivery_code_hash is null or btrim(new.delivery_code_hash) = '' then
    new.delivery_code_hash := crypt(new.delivery_code, gen_salt('bf', 8));
  end if;

  return new;
end;
$$;

drop trigger if exists orders_set_delivery_code_trg on public.orders;

create trigger orders_set_delivery_code_trg
  before insert on public.orders
  for each row
  execute function public.orders_set_delivery_code();
