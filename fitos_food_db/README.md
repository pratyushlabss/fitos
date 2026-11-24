# FitOS Food Database

15,021 foods with calories, protein, carbs, fat, fibre, sugar, saturated fat and sodium per 100 g. Indian foods also have potassium, calcium, iron and vitamin C. Every row says where its numbers came from.

## What's inside

| Tier | Rows | Where the numbers come from | Use it |
|---|---|---|---|
| `lab_verified` | 13,629 | IFCT 2017 (542 Indian foods, NIN Hyderabad), USDA SR Legacy (~5,965), BLS 4.0 (7,108 European foods and dishes), plus small CoFID/Swedish/FNDDS extracts | First choice |
| `recipe_calculated` | 94 | Home-style recipes (Indian, Asian, Mexican, Middle Eastern, Aussie) calculated from lab-verified ingredients. Only the recipe (ingredients, grams, cooked weight) is assumed; every nutrient value comes from the lab data. | First choice for dishes |
| `community` | 1,298 | Open Indian Nutrition Engine (MIT). Not lab-verified. 44 rows dropped for failing the energy check, 77 dropped as duplicates of recipe dishes | Only when nothing better matches. Show it as "unverified". |

**Synthetic data** appears in one place only: `eval_queries.csv`. It contains test searches (exact names, regional aliases, typos, "2 piece idli", plus made-up dishes that must return NO_MATCH or CLARIFY). No nutrient value anywhere in this set is generated.

## Files

- `foods.csv`: one row per food, values per 100 g (edible portion). `carbs_g` is available carbohydrate, with fibre listed separately. `aliases` are semicolon-separated and include regional Indian names from IFCT (Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali and others), so "kambu" finds bajra and "thayir sadam" finds curd rice.
- `food_servings.csv`: units to grams (piece, katori, ladle, plate, glass, tbsp...).
- `dish_ingredients.csv`: the recipe behind every `recipe_calculated` dish, so the app can show the ingredients and let users adjust oil, ghee or portions.
- `eval_queries.csv`: 447 test queries with the expected result.
- `schema.sql`: Supabase tables, trigram indexes and RLS. The import was tested on Postgres 16.
- `build/`: the scripts that produced everything, so you can rerun them or add recipes.

## Quality checks done

- Each food's calories are checked against its macros (4 kcal/g protein and carbs, 9 fat, 2 fibre). Rows more than 15% off have `energy_check = flag`. The remaining flags are mostly alcoholic drinks and sugar-alcohol products, where the source value is correct but alcohol and polyols aren't in the macro columns.
- Some IFCT entries (the oils and ghee, plus a few others) were missing energy values or had inconsistent ones. Those calories were recalculated from the macros using IFCT's own factors, and the `notes` column says so.
- All servings, recipe ingredients and eval queries point to real IDs, with no orphans.

## Known limits

- This isn't every food in the world. Packaged and branded products come from Open Food Facts barcode lookups, not this file.
- Recipe dishes are home-style. Restaurant versions often have 1.5–2× the oil, so the app should offer the oil-level chip.
- Poha and rice-flour items use milled rice as a stand-in because IFCT has no rice flakes. The `notes` column says so.

## Attribution (show it in the app's About screen)

- IFCT 2017: Longvah T. et al., *Indian Food Composition Tables 2017*, National Institute of Nutrition (ICMR), Hyderabad. Digitised by the `ifct2017` package (AGPL-3.0).
- USDA FoodData Central SR Legacy: public domain (CC0), via the TempoLife extract: "Food nutrition data from TempoLife (tempolife.app), CC-BY-4.0."
- Max Rubner-Institut (2025), Bundeslebensmittelschlüssel (BLS) 4.0, CC BY 4.0, via `@thereforejs/foods`.
- UK CoFID 2021 (Open Government Licence v3.0); Swedish Food Agency.
- Open Indian Nutrition Engine (MIT), community tier.

AGPL note: a private app for you and your friends is fine. Before you sell FitOS, check the AGPL terms on the IFCT digitisation, or re-key the values from the NIN book.
