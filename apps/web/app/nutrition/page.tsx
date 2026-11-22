import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { mealSeed } from "@/lib/demoData";

export default function NutritionPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Nutrition"
        title="Daily nutrition"
        subtitle="Calories, macros, barcode, OCR, and meal logging in one place"
      />

      <div className="space-y-5">
        <SectionCard title="Macro balance">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Calories" value="1,640" hint="Remaining 460" accent />
            <StatCard label="Protein" value="126g" hint="Target 160g" />
            <StatCard label="Carbs" value="170g" hint="Target 200g" />
            <StatCard label="Fat" value="52g" hint="Target 60g" />
          </div>
        </SectionCard>

        <SectionCard title="Actions">
          <div className="grid grid-cols-2 gap-2">
            <Button className="w-full">+ Add food</Button>
            <Button variant="secondary" className="w-full">📷 Scan food</Button>
            <Button variant="secondary" className="w-full">▣ Barcode</Button>
            <Button variant="secondary" className="w-full">🎙 Voice</Button>
            <Button variant="secondary" className="w-full">🔎 Search</Button>
            <Button variant="secondary" className="w-full">🍳 Recipe</Button>
          </div>
        </SectionCard>

        <SectionCard title="Meals">
          <div className="space-y-2">
            {mealSeed.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-3">
                <div>
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="text-xs text-slate-400">{item.protein}P • {item.carbs}C • {item.fat}F</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-white">{item.calories} kcal</p>
                  <p className="text-xs text-slate-400">1 serving</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
