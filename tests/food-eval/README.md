# Food AI eval

- `cases.json` holds 20 text cases and the photo cases. Each case lists expected item keywords and an approximate total kcal.
- Photo cases: put up to 20 images in `images/`, then add one entry per image to `photos` with `file`, `items` and `kcal`. Entries whose file is missing are skipped.
- Run it with `scripts/food_eval.ts`. The header of that script lists the environment variables.
