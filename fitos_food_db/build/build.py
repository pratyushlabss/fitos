import csv, json, re, subprocess, random, unicodedata
from pathlib import Path
from recipes import ING, R

RAW = Path("raw")
OUT = Path("fitos_food_db")
OUT.mkdir(exist_ok=True)
random.seed(7)

COLS = ["id","name","aliases","cuisine","category","food_type","tier","verified","source","source_ref",
        "kcal","protein_g","carbs_g","fibre_g","sugar_g","fat_g","sat_fat_g","sodium_mg",
        "potassium_mg","calcium_mg","iron_mg","vit_c_mg","energy_check","notes","embed_text"]
NUTS = ["kcal","protein_g","carbs_g","fibre_g","sugar_g","fat_g","sat_fat_g","sodium_mg","potassium_mg","calcium_mg","iron_mg","vit_c_mg"]


def f(v, mult=1.0):
    try:
        if v is None or str(v).strip() == "":
            return None
        return float(v) * mult
    except ValueError:
        return None


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def atwater(r):
    p, c, fat, fib = (r.get(k) or 0 for k in ("protein_g", "carbs_g", "fat_g", "fibre_g"))
    return 4 * p + 4 * c + 9 * fat + 2 * fib


def check(r):
    if r.get("kcal") is None:
        return "missing"
    est = atwater(r)
    if r["kcal"] < 5 and est < 5:
        return "ok"
    return "ok" if abs(est - r["kcal"]) / max(r["kcal"], 1) <= 0.15 else "flag"


foods = []

# IFCT 2017 (India, lab analysed). Values in g/100g, energy kJ.
ifct = {}
LANG = re.compile(r"^(A|B|E|G|H|Kan|Kash|Kh|Kon|Mal|M|Mar|N|O|P|S|Tam|Tel|U|Tu)\.\s*")
for x in csv.DictReader(open(RAW / "ifct2017-2.1.2/package/compositions/index.csv")):
    al = set()
    for part in re.split(r";", x["lang"] or ""):
        part = LANG.sub("", part.strip()).strip(" .")
        part = re.sub(r"^[A-Z][a-z]*\.,\s*", "", part)
        for a in re.split(r"[,/]\s*", part):
            a = a.strip(" .()")
            while re.match(r"^[A-Za-z]{1,5}\.\s*", a):
                a = re.sub(r"^[A-Za-z]{1,5}\.\s*", "", a, count=1)
            if 2 < len(a) < 40:
                al.add(a.lower())
    r = dict(id=f"ifct-{x['code'].lower()}", name=x["name"], aliases=";".join(sorted(al)), cuisine="indian",
             category=x["grup"], food_type="ingredient", tier="lab_verified", verified=True,
             source="IFCT 2017 (NIN Hyderabad)", source_ref=x["code"],
             kcal=f(x["enerc"], 1 / 4.184), protein_g=f(x["protcnt"]), carbs_g=f(x["choavldf"]),
             fibre_g=f(x["fibtg"]), sugar_g=f(x["fsugar"]), fat_g=f(x["fatce"]), sat_fat_g=f(x["fasat"]),
             sodium_mg=f(x["na"], 1000), potassium_mg=f(x["k"], 1000), calcium_mg=f(x["ca"], 1000),
             iron_mg=f(x["fe"], 1000), vit_c_mg=f(x["vitc"], 1000), notes="raw/as analysed")
    if check(r) != "ok":
        r["kcal"] = atwater(r)
        r["notes"] += "; kcal recomputed from macros (IFCT factors 4/4/9/2) because source energy was missing or inconsistent"
    foods.append(r)
    ifct[x["code"]] = r

# USDA SR Legacy (public domain) via TempoLife extract. carbs are by difference incl. fibre.
sr = {}
for x in csv.DictReader(open(RAW / "tempo-food-db/package/data/tempolife-foods.csv")):
    if x["source"] != "usda_sr_legacy" or x["name"] in sr:
        continue
    carbs, fib = f(x["carbs"]), f(x["fiber"])
    avail = None if carbs is None else max(carbs - (fib or 0), 0)
    salt = f(x["salt"])
    r = dict(id=f"usda-{slug(x['name'])}-{x['id']}", name=x["name"], aliases="", cuisine="global",
             category=x["name"].split(",")[0], food_type="ingredient", tier="lab_verified", verified=True,
             source="USDA FoodData Central SR Legacy", source_ref=x["id"],
             kcal=f(x["calories"]), protein_g=f(x["protein"]), carbs_g=avail, fibre_g=fib,
             sugar_g=f(x["sugar"]), fat_g=f(x["fat"]), sat_fat_g=f(x["saturated_fat"]),
             sodium_mg=None if salt is None else salt / 2.5 * 1000,
             potassium_mg=None, calcium_mg=None, iron_mg=None, vit_c_mg=None, notes="")
    foods.append(r)
    sr[x["name"]] = r

# BLS 4.0 + others via @thereforejs/foods (each value cites its source)
js = r"""
import * as m from './raw/_thereforejs_foods/package/dist/index.mjs';
const a=Object.values(m).filter(v=>v&&v.code&&v.per100g&&!v.sources.some(s=>s.source.includes('branded')));
process.stdout.write(JSON.stringify(a));
"""
bls = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout)
SRCNAME = {"bls-4.0": "BLS 4.0 (Max Rubner-Institut)", "cofid-2021": "UK CoFID 2021",
           "usda-sr-legacy": "USDA SR Legacy", "usda-fndds-2024": "USDA FNDDS 2024",
           "livsmedelsverket-2026": "Swedish Food Agency 2026"}
for x in bls:
    p = x["per100g"]
    src = x["sources"][0]["source"]
    r = dict(id=f"bls-{x['code'].lower()}", name=x["name"].get("en") or x["name"].get("de"),
             aliases=(x["name"].get("de") or "").lower(), cuisine="european", category="",
             food_type="dish" if re.search(r"(with|filled|sauce|soup|stew|gratin|salad|pizza|cake|in |fried|baked|boiled|grilled)", (x["name"].get("en") or "").lower()) else "ingredient",
             tier="lab_verified", verified=True, source=SRCNAME.get(src, src), source_ref=x["code"],
             protein_g=f(p.get("protein")), carbs_g=f(p.get("carbohydrate")), fibre_g=f(p.get("fibre")),
             sugar_g=f(p.get("sugars")), fat_g=f(p.get("fat")), sat_fat_g=f(p.get("saturates")),
             sodium_mg=f(p.get("sodium"), 1000), potassium_mg=None, calcium_mg=None, iron_mg=None, vit_c_mg=None,
             notes="kcal computed with EU energy factors")
    kc = (4 * (r["protein_g"] or 0) + 4 * (r["carbs_g"] or 0) + 9 * (r["fat_g"] or 0) + 2 * (r["fibre_g"] or 0)
          + 7 * (f(p.get("alcohol")) or 0) + 2.4 * (f(p.get("polyols")) or 0) + 3 * (f(p.get("organicAcids")) or 0))
    r["kcal"] = kc
    foods.append(r)

# Recipe-calculated dishes (synthetic recipes, real ingredient values)
def ref(k):
    t, v = ING[k].split(":", 1)
    return ifct[v] if t == "ifct" else sr[v]

recipe_rows, serving_rows, dish_rows = [], [], []
for name, aliases, cuisine, cat, ings, cooked, servings, note in R:
    did = f"dish-{slug(name)}"
    tot = {k: 0.0 for k in NUTS}
    missing = set()
    for k, g in ings:
        src = ref(k)
        for n in NUTS:
            if src[n] is None:
                missing.add(n)
            else:
                tot[n] += src[n] * g / 100
        recipe_rows.append(dict(dish_id=did, ingredient_id=src["id"], ingredient_name=src["name"], raw_grams=g))
    r = dict(id=did, name=name, aliases=aliases, cuisine=cuisine, category=cat, food_type="dish",
             tier="recipe_calculated", verified=True, source="FitOS recipe calc from IFCT/USDA",
             source_ref=f"cooked_total_g={cooked}",
             notes="; ".join(filter(None, [note, "home-style standard recipe; values per 100 g cooked",
                                           ("incomplete: " + ",".join(sorted(missing))) if missing else ""])))
    for n in NUTS:
        r[n] = None if n in missing else tot[n] / cooked * 100
    foods.append(r)
    dish_rows.append(r)
    for unit, g in servings:
        serving_rows.append(dict(food_id=did, unit=unit, grams=g, label=f"1 {unit} ({g} g)"))

# Community tier: curated Indian dishes (unverified source; kept for coverage + aliases, never preferred)
js2 = r"""
const m=require('./raw/open-nutrition-engine-1.1.0/package/dist/index.js');
process.stdout.write(JSON.stringify(m.FOODS.filter(f=>!/-\d{6}$/.test(f.id))));
"""
comm = json.loads(subprocess.run(["node", "-e", js2], capture_output=True, text=True, check=True).stdout)
dish_names = {d["name"].lower() for d in dish_rows} | {a for d in dish_rows for a in d["aliases"].split(";")}
dropped = 0
dup = 0
for x in comm:
    r = dict(id=f"comm-{slug(x['id'])}", name=x["name"], aliases=(x.get("hindiName") or "").lower(),
             cuisine="indian", category=x.get("category", ""), food_type="dish", tier="community", verified=False,
             source="Open Indian Nutrition Engine (community, MIT)", source_ref=x["id"],
             kcal=f(x.get("calories")), protein_g=f(x.get("protein")), carbs_g=f(x.get("carbs")),
             fibre_g=f(x.get("fiber")), sugar_g=None, fat_g=f(x.get("fat")), sat_fat_g=None, sodium_mg=None,
             potassium_mg=None, calcium_mg=None, iron_mg=None, vit_c_mg=None,
             notes="unverified community values; use only when no lab/recipe match")
    if check(r) == "flag":
        dropped += 1
        continue
    if r["name"].lower() in dish_names or (r["aliases"] and r["aliases"] in dish_names):
        dup += 1
        continue
    foods.append(r)
    for s in x.get("servings", []):
        if s.get("amount") and s["id"] != "100g":
            serving_rows.append(dict(food_id=r["id"], unit=s["id"], grams=s["amount"], label=s["label"]))

# Generic Indian portion units for lab ingredients that are commonly eaten as-is
for r in foods:
    r["energy_check"] = check(r)
    r["embed_text"] = " | ".join(filter(None, [r["name"], r["aliases"].replace(";", ", "), r["cuisine"], r["category"]]))

ids = [r["id"] for r in foods]
assert len(ids) == len(set(ids)), "duplicate ids"

with open(OUT / "foods.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, COLS)
    w.writeheader()
    for r in foods:
        w.writerow({k: (round(r[k], 3) if isinstance(r.get(k), float) else r.get(k)) for k in COLS})

with open(OUT / "food_servings.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, ["food_id", "unit", "grams", "label"]); w.writeheader(); w.writerows(serving_rows)

with open(OUT / "dish_ingredients.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, ["dish_id", "ingredient_id", "ingredient_name", "raw_grams"]); w.writeheader(); w.writerows(recipe_rows)

# Synthetic eval queries (the only synthetic text in the set)
def typo(s):
    i = [j for j, c in enumerate(s) if c in "aeiou"]
    return s if len(i) < 2 else s[:i[1]] + s[i[1] + 1:]

qs = []
for d in dish_rows:
    al = [a for a in d["aliases"].split(";") if a]
    unit = next((s for s in serving_rows if s["food_id"] == d["id"]), None)
    qs.append((d["name"].lower(), d["id"], "exact"))
    if al:
        qs.append((random.choice(al), d["id"], "alias"))
    qs.append((typo(d["name"].lower()), d["id"], "typo"))
    if unit:
        qs.append((f"2 {unit['unit']} {d['name'].lower()}", d["id"], "quantity"))
for code in random.sample(sorted(ifct), 60):
    r = ifct[code]
    al = [a for a in r["aliases"].split(";") if a]
    if al:
        qs.append((random.choice(al), r["id"], "regional_name"))
for fake in ["zorblax", "krellish noodle bake", "blorp kebab", "spiced nebula stew", "vortex gloop", "flimflam pie"]:
    qs.append((fake, "NO_MATCH", "hallucination_trap"))
for mixed in ["moonberry biryani", "quantum paneer", "glimmer dosa supreme", "unicorn roti", "dragon vindaloo pie"]:
    qs.append((mixed, "CLARIFY", "partial_real_word"))
with open(OUT / "eval_queries.csv", "w", newline="") as fh:
    w = csv.writer(fh); w.writerow(["query", "expected_food_id", "kind"]); w.writerows(qs)

stats = {}
for r in foods:
    stats.setdefault(r["source"], 0); stats[r["source"]] += 1
print(json.dumps({"total": len(foods), "by_source": stats, "dishes_calc": len(dish_rows),
                  "community_dropped_atwater": dropped, "community_dropped_duplicate": dup, "servings": len(serving_rows), "eval_queries": len(qs),
                  "energy_flag": sum(r["energy_check"] == "flag" for r in foods),
                  "with_fibre": sum(r["fibre_g"] is not None for r in foods)}, indent=1))
