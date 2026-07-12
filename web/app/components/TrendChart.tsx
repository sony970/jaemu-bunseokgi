"use client";

type Series = { name: string; color: string; values: (number | null)[] };

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };

export default function TrendChart({ years, series }: { years: number[]; series: Series[] }) {
  const plotW = WIDTH - PADDING.left - PADDING.right;
  const plotH = HEIGHT - PADDING.top - PADDING.bottom;

  const allValues = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (allValues.length === 0 || years.length === 0) return null;

  const rawMax = Math.max(...allValues);
  const rawMin = Math.min(0, ...allValues);
  const range = rawMax - rawMin || 1;
  const yMax = rawMax + range * 0.1;
  const yMin = rawMin - range * 0.1;

  const xFor = (i: number) => (years.length === 1 ? plotW / 2 : (i / (years.length - 1)) * plotW);
  const yFor = (v: number) => plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const gridLines = 4;
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / gridLines);

  function formatAxisValue(v: number) {
    const abs = Math.abs(v);
    if (abs >= 1_0000_0000) return (v / 1_0000_0000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "억";
    return v.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  }

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto">
        <g transform={`translate(${PADDING.left}, ${PADDING.top})`}>
          {gridValues.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={plotW} y1={yFor(v)} y2={yFor(v)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={-8} y={yFor(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#9ca3af">
                {formatAxisValue(v)}
              </text>
            </g>
          ))}

          {years.map((year, i) => (
            <text key={year} x={xFor(i)} y={plotH + 18} textAnchor="middle" fontSize={11} fill="#6b7280">
              {year}
            </text>
          ))}

          {series.map((s) => {
            const points = s.values
              .map((v, i) => (v === null ? null : { x: xFor(i), y: yFor(v) }))
              .filter((p): p is { x: number; y: number } => p !== null);
            if (points.length === 0) return null;
            const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            return (
              <g key={s.name}>
                <path d={path} fill="none" stroke={s.color} strokeWidth={2} />
                {points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color} />
                ))}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 justify-center">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}
