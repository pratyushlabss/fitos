# Nutrition test script

Run these after deploying migrations 009 and 010, `nutrition-ai`, `barcode` and `embed-worker`, with `AI_PROVIDER` and `AI_API_KEY` set. Use Nutrition › Add unless the step says otherwise.

| # | Do this | What should happen |
|---|---|---|
| 1 | Describe: `2 masala dosa with sambar and chutney` | A review with 3 dishes. Masala dosa is about 200 g, with ingredients (rice, urad dal, potato, oil). Badges say AI estimate. Confidence shows. Save it to Breakfast and the ring moves. |
| 2 | Describe the same text again, or `two masala dosas with sambar & chutney` | It returns in under a second with "From your past log" or "Matched in your food database". No AI call is used, and the database's `food_analyses.cache_hit` or `ai_calls = 0` confirms it. |
| 3 | Describe: `2 roti and 1 katori dal` | Roti is about 80 g (2 × 40 g) and dal about 150 g. Change the dal to 200 g in Review: macros update live. Save. A `user_corrections` row is written. |
| 4 | Repeat step 3 another day and edit the dal the same way | After the second correction, the save message says your own version will be used. Next time, the dal item has the **Mine** badge. |
| 5 | Describe: `chicken biryani` | One plate of about 300 g, broken into rice, chicken, ghee and onion. If confidence is low, you get at most one question, for example "Restaurant or home-made?". Answer it and the draft updates. |
| 6 | Photo: a thali | Every item appears (rice, dal, sabzi, roti, curd, pickle), each with grams. Visible ghee or oil becomes its own line. Known items show a database badge. Only unknown dishes are broken down. |
| 7 | Barcode: scan a Vegemite jar, or type `9300650658516` | Draft of 1 serving with the Barcode badge. Change it to 5 g and save. Scanning again is instant, because the food is cached. |
| 8 | Manual: "Amma's sambar", 1 katori = 150 g, 120 kcal, 6 g protein | Saved to My foods and logged. Search › My foods lists it, and it ranks first when you search "sambar". |
| 9 | Coach: "What's left today?" | A short answer with exact remaining kcal and protein from `get_day_summary`. |
| 10 | Coach: "Log my breakfast: 2 idli and sambar", then "yes" | It shows the draft and asks to confirm. Nothing is logged until you say yes. After "yes" the items appear under Breakfast. "Review and edit" opens the review screen instead. |

Extra checks:

- **The AI limit:** make 30 AI requests in a day. The next one says the limit is reached, and "Log it manually" still works.
- **Coach memory:** tell the coach "I'm vegetarian, I cook with coconut oil". Ask later what you usually cook with: it remembers.
- **History:** Nutrition › History lists each day as "Day N · date · kcal" against your goal, with weekly averages.
