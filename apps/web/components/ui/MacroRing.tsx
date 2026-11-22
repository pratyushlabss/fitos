export function MacroRing({
  label,
  value,
  target,
  unit,
  color = "#3DDC97",
  size = 76,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color?: string;
  size?: number;
}) {
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const over = target > 0 && value > target * 1.05;
  return (
    <div className="flex flex-col items-center gap-1" aria-label={`${label}: ${value} of ${target} ${unit}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(148,163,184,.18)" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={over ? "#F5C451" : color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            style={{ transition: "stroke-dashoffset .4s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-semibold text-white">{Math.round(value)}</span>
          <span className="text-[10px] text-slate-500">/ {target}</span>
        </div>
      </div>
      <span className="text-[11px] uppercase tracking-[0.12em] text-slate-400">
        {label} <span className="normal-case tracking-normal">{unit}</span>
      </span>
    </div>
  );
}
