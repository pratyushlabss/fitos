Paste this into Claude Code after copying the `fitos_food_db/` folder into the repo root.

```
Import fitos_food_db/ as FitOS's main food database and wire it into the nutrition pipeline so the AI never invents nutrition values. Read fitos_food_db/README.md and schema.sql first. Map the data onto my existing tables (foods, food_nutrition, food_servings, dish_ingredients, and the embedding column from the RAG migration) instead of creating duplicates; use schema.sql only where a table doesn't exist. Targeted edits only.

1. IMPORT
- scripts/import_food_db.ts: load foods.csv, food_servings.csv and dish_ingredients.csv in batches of 500 with upsert on id. Keep tier, verified, source, source_ref, energy_check and notes. Store aliases as text (semicolon-separated) or text[], whichever my schema already uses.
- Delete the old IFCT-only importer if this replaces it.
- After the import, run embed-worker to fill embeddings from embed_text.
- Add the attribution list from the README to the app's About / Data sources screen.

2. SEARCH RANKING (update match_foods)
- Score = max(trigram similarity(name), word_similarity(query, aliases)), fused with vector similarity (RRF).
- Tier boost: user's own corrected foods > recipe_calculated > lab_verified > community. Never return community above a lab/recipe match with a similar score.
- For energy_check = 'flag', show a small "check values" note.

3. NO-HALLUCINATION RULES (enforce in code, not only in prompts)
- The AI may only (a) pick a food_id from the retrieved candidates, (b) estimate grams/portions, or (c) break an unknown dish into ingredients that are themselves picked from the candidates.
- Every nutrient number shown or saved is computed in code from database rows × grams. The model's own numbers are ignored for anything matched.
- If no candidate passes the threshold and the dish can't be built from known ingredients: return "I don't know this one yet". Offer manual entry or "describe the ingredients", and save the user's entry as tier 'user'.
- If the query mixes a real food word with unknown words (e.g. "moonberry biryani"), ask ONE clarifying question with tappable options (closest real matches + "something else"). Never silently map it.
- Mark any AI-built dish as tier 'ai_estimate' with its ingredient list, and show the badge "AI estimate from ingredients".

4. RECIPE DISHES
- In the review draft, recipe_calculated dishes expand to their dish_ingredients. Users can change oil/ghee grams or portion, and nutrients recompute live from the ingredient rows.
- Oil-level chip (none / light / normal / heavy = ×0, ×0.5, ×1, ×1.8 of the recipe's oil/ghee lines) for dishes that contain oil or ghee.

5. EVAL (must pass before finishing)
- scripts/food_search_eval.ts runs every row of eval_queries.csv through the same search + pipeline:
  - exact / alias / typo / quantity / regional_name: expected_food_id in the top 3 (report top-1 and top-3 accuracy). Target top-3 ≥ 90%.
  - hallucination_trap: must return NO_MATCH — target 100%.
  - partial_real_word: must return CLARIFY — target 100%.
- Print failures with their top candidates, tune thresholds/aliases until the targets pass, and record the results in PROGRESS.md.

Update FEATURES.md and DEPLOY.md (add: run scripts/import_food_db.ts, then embed-worker).
```
