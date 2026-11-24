-- Reference schema for the FitOS food database. If your migrations already have
-- foods / food_nutrition / food_servings / dish_ingredients, map these columns onto them instead.

create extension if not exists pg_trgm;
create extension if not exists vector;

create table if not exists food_db (
  id text primary key,
  name text not null,
  aliases text, -- semicolon-separated
  cuisine text,
  category text,
  food_type text check (food_type in ('ingredient','dish','packaged')),
  tier text check (tier in ('lab_verified','recipe_calculated','community','user','ai_estimate')),
  verified boolean default false,
  source text,
  source_ref text,
  kcal numeric, protein_g numeric, carbs_g numeric, fibre_g numeric, sugar_g numeric,
  fat_g numeric, sat_fat_g numeric, sodium_mg numeric, potassium_mg numeric,
  calcium_mg numeric, iron_mg numeric, vit_c_mg numeric,
  energy_check text,
  notes text,
  embed_text text,
  embedding vector(384)
);

create table if not exists food_db_servings (
  food_id text references food_db(id) on delete cascade,
  unit text, grams numeric, label text
);

create table if not exists food_db_dish_ingredients (
  dish_id text references food_db(id) on delete cascade,
  ingredient_id text references food_db(id),
  ingredient_name text,
  raw_grams numeric
);

create index if not exists food_db_name_trgm on food_db using gin (name gin_trgm_ops);
create index if not exists food_db_aliases_trgm on food_db using gin (aliases gin_trgm_ops);
create index if not exists food_db_tier on food_db (tier);

alter table food_db enable row level security;
alter table food_db_servings enable row level security;
alter table food_db_dish_ingredients enable row level security;
create policy "read food_db" on food_db for select to authenticated using (true);
create policy "read servings" on food_db_servings for select to authenticated using (true);
create policy "read dish ingredients" on food_db_dish_ingredients for select to authenticated using (true);

-- Load (psql):
-- \copy food_db(id,name,aliases,cuisine,category,food_type,tier,verified,source,source_ref,kcal,protein_g,carbs_g,fibre_g,sugar_g,fat_g,sat_fat_g,sodium_mg,potassium_mg,calcium_mg,iron_mg,vit_c_mg,energy_check,notes,embed_text) from 'foods.csv' csv header
-- \copy food_db_servings from 'food_servings.csv' csv header
-- \copy food_db_dish_ingredients from 'dish_ingredients.csv' csv header
-- Then run the embed-worker to fill embedding (built-in gte-small, 384 dims).
