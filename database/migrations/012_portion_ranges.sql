-- Plausible grams per unit, used to sanity-check AI portions before a draft is returned.
-- A row with a name pattern (case-insensitive regex) applies to matching foods; a row without one is the
-- unit default. Ranges are per single unit (one roti, one katori, one piece).

create table if not exists public.portion_ranges (
  id bigint generated always as identity primary key,
  unit text not null check (unit in ('roti', 'katori', 'ladle', 'piece', 'plate', 'cup', 'tbsp', 'serving')),
  name_pattern text,
  min_g numeric(7, 1) not null check (min_g > 0),
  max_g numeric(7, 1) not null check (max_g >= min_g),
  note text,
  unique nulls not distinct (unit, name_pattern)
);

alter table public.portion_ranges enable row level security;

drop policy if exists portion_ranges_read on public.portion_ranges;
create policy portion_ranges_read on public.portion_ranges for select to authenticated using (true);

revoke all on public.portion_ranges from anon;
grant select on public.portion_ranges to authenticated;

insert into public.portion_ranges (unit, name_pattern, min_g, max_g, note) values
  -- unit defaults
  ('roti', null, 25, 60, 'one roti or chapati'),
  ('katori', null, 100, 200, 'one katori (small bowl)'),
  ('ladle', null, 80, 150, 'one serving ladle'),
  ('plate', null, 150, 500, 'one plate'),
  ('cup', null, 120, 300, 'one cup or glass'),
  ('tbsp', null, 5, 20, 'one tablespoon'),
  ('serving', null, 30, 600, 'one generic serving'),
  -- Indian pieces
  ('piece', 'dosa', 70, 150, 'one dosa'),
  ('piece', 'uttapam', 90, 180, 'one uttapam'),
  ('piece', 'idli', 30, 60, 'one idli'),
  ('piece', 'vada|vadai', 40, 80, 'one vada'),
  ('piece', 'roti|chapati|phulka', 25, 60, 'one roti'),
  ('piece', 'paratha|parotta', 50, 120, 'one paratha'),
  ('piece', 'naan', 70, 130, 'one naan'),
  ('piece', 'puri|poori', 15, 35, 'one puri'),
  ('piece', 'samosa', 40, 120, 'one samosa'),
  ('piece', 'pakora|bhaji|bajji', 15, 50, 'one pakora'),
  ('piece', 'gulab jamun', 25, 60, 'one gulab jamun'),
  ('piece', 'ladoo|laddu', 25, 60, 'one ladoo'),
  ('piece', 'appam', 50, 100, 'one appam'),
  -- Western and Australian pieces
  ('piece', 'egg', 40, 65, 'one egg'),
  ('piece', 'banana', 80, 150, 'one banana, peeled'),
  ('piece', 'apple', 120, 250, 'one apple'),
  ('piece', 'orange', 100, 220, 'one orange'),
  ('piece', 'bread|toast', 25, 50, 'one slice'),
  ('piece', 'croissant', 40, 90, 'one croissant'),
  ('piece', 'meat pie|pie', 150, 260, 'one single-serve pie'),
  ('piece', 'sausage roll', 60, 180, 'one sausage roll'),
  ('piece', 'muffin', 60, 150, 'one muffin'),
  ('piece', 'cookie|biscuit', 8, 40, 'one cookie or biscuit'),
  ('piece', 'pizza', 80, 180, 'one slice of pizza'),
  ('piece', 'burger', 150, 350, 'one burger'),
  ('piece', 'sandwich|wrap', 120, 320, 'one sandwich or wrap'),
  ('piece', 'chicken breast', 100, 250, 'one chicken breast'),
  ('piece', 'sausage', 40, 110, 'one sausage'),
  ('piece', 'lamington', 40, 90, 'one lamington'),
  ('piece', 'anzac', 15, 35, 'one Anzac biscuit'),
  ('piece', 'tim ?tam', 15, 25, 'one Tim Tam'),
  -- unit plus food
  ('cup', 'rice', 120, 200, 'one cup of cooked rice'),
  ('cup', 'coffee|latte|flat white|cappuccino|tea|chai', 150, 350, 'one cup of a drink'),
  ('katori', 'rice', 100, 180, 'one katori of cooked rice'),
  ('katori', 'dal|sambar|rasam|curry|sabzi|sabji', 100, 200, 'one katori of a curry'),
  ('plate', 'biryani|pulao|fried rice', 200, 450, 'one plate of rice dish')
on conflict (unit, name_pattern) do nothing;
