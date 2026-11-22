# FITOS Integration Matrix

External systems are adapters, never domain dependencies. The native FITOS
database and services continue to operate when any optional provider is down.

| Provider | Capability | Status | Adapter | Fallback |
|---|---|---|---|---|
| Supabase | PostgreSQL, initial auth/storage integration | Core initial platform | `backend/api/deps.py`, repositories | PostgreSQL + replaceable auth/storage ports |
| Open Food Facts | Product barcode and packaged food lookup | Fallback | `backend/adapters/open_food_facts/` | Manual product entry, USDA, curated FITOS records |
| USDA FoodData Central | Nutrition lookup | Fallback | `backend/adapters/usda/` | Open Food Facts, curated records, manual values |
| Anthropic vision | Meal photo identification | Optional | `backend/adapters/claude/` | Search, barcode, manual meal logging |
| Apple Health / HealthKit | Native mobile health ingestion | Future adapter | Not implemented | Manual health data and native FITOS activity |
| Android Health Connect | Native mobile health ingestion | Future adapter | Not implemented | Manual health data and native FITOS activity |
| Strava | Activity import | Explicitly optional | Not implemented | Native GPS activity engine |
| Hevy | Workout import/export | Explicitly optional | Not implemented | Native FITOS workout engine |

Before enabling a provider, verify its current official documentation for
authentication, permissions, rate limits, pricing, licensing, commercial use,
and data retention. Store those verified values with the release documentation;
do not make undocumented API assumptions part of FITOS core behavior.