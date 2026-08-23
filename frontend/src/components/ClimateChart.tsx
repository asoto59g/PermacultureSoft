"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ChartSeries {
  name: string;
  color: string;
  values: (number | null)[];
  type: "line" | "bar";
  /** Trazo punteado, para distinguir pronóstico o referencia. */
  dashed?: boolean;
}

interface Props {
  categories: string[];
  series: ChartSeries[];
  yLabel: string;
  xLabel: string;
  height?: number;
  /** Fuerza el cero en el eje Y. Obligatorio en barras. */
  zeroBased?: boolean;
  /** Banda sombreada opcional, por ejemplo mínima–máxima de temperatura. */
  band?: { lower: (number | null)[]; upper: (number | null)[]; color: string; name: string };
}

const PAD = { top: 12, right: 14, bottom: 30, left: 52 };

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min, max];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step =
    (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.5; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(abs % 1 === 0 ? 0 : 1);
  return value.toFixed(abs % 1 === 0 ? 0 : 1);
}

export function ClimateChart({
  categories,
  series,
  yLabel,
  xLabel,
  height = 240,
  zeroBased,
  band,
}: Props) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = Math.max(80, width - PAD.left - PAD.right);
  const innerH = Math.max(60, height - PAD.top - PAD.bottom);
  const n = categories.length;
  const hasBars = series.some((s) => s.type === "bar");

  const { ticks, scaleY } = useMemo(() => {
    const all: number[] = [];
    for (const s of series) {
      for (const v of s.values) if (typeof v === "number" && Number.isFinite(v)) all.push(v);
    }
    if (band) {
      for (const v of [...band.lower, ...band.upper]) {
        if (typeof v === "number" && Number.isFinite(v)) all.push(v);
      }
    }
    if (!all.length) return { ticks: [0, 1], scaleY: () => innerH };
    let min = Math.min(...all);
    let max = Math.max(...all);
    if (zeroBased || hasBars) min = Math.min(0, min);
    if (max === min) max = min + 1;
    const pad = (max - min) * 0.08;
    const lo = zeroBased || hasBars ? min : min - pad;
    const hi = max + pad;
    const tickValues = niceTicks(lo, hi, 4);
    const domainLo = Math.min(lo, tickValues[0]);
    const domainHi = Math.max(hi, tickValues[tickValues.length - 1]);
    return {
      ticks: tickValues,
      scaleY: (value: number) =>
        innerH - ((value - domainLo) / (domainHi - domainLo)) * innerH,
    };
  }, [series, band, innerH, zeroBased, hasBars]);

  const bandW = n > 0 ? innerW / n : innerW;
  const scaleX = useCallback(
    (index: number) => (n <= 1 ? innerW / 2 : bandW * index + bandW / 2),
    [bandW, innerW, n]
  );

  const xTickIndexes = useMemo(() => {
    if (n <= 1) return [0];
    const maxLabels = Math.max(2, Math.min(12, Math.floor(innerW / 60)));
    const stride = Math.max(1, Math.ceil(n / maxLabels));
    const out: number[] = [];
    for (let i = 0; i < n; i += stride) out.push(i);
    return out;
  }, [n, innerW]);

  const linePath = useCallback(
    (values: (number | null)[]) => {
      let path = "";
      let pen = false;
      values.forEach((value, index) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          pen = false;
          return;
        }
        const x = scaleX(index);
        const y = scaleY(value);
        path += `${pen ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
        pen = true;
      });
      return path;
    },
    [scaleX, scaleY]
  );

  const bandPath = useMemo(() => {
    if (!band) return "";
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const upper = band.upper[i];
      const lower = band.lower[i];
      if (
        typeof upper !== "number" ||
        !Number.isFinite(upper) ||
        typeof lower !== "number" ||
        !Number.isFinite(lower)
      ) {
        continue;
      }
      top.push(`${scaleX(i).toFixed(2)},${scaleY(upper).toFixed(2)}`);
      bottom.unshift(`${scaleX(i).toFixed(2)},${scaleY(lower).toFixed(2)}`);
    }
    if (!top.length) return "";
    return `M${top.join("L")}L${bottom.join("L")}Z`;
  }, [band, n, scaleX, scaleY]);

  const barSeries = series.filter((s) => s.type === "bar");
  const grouped = barSeries.length > 1 && n <= 31;
  // Con muy pocas categorías una barra proporcional queda absurdamente ancha.
  const slot = Math.min(bandW * 0.7, 56);
  const barW = grouped ? Math.max(1, slot / barSeries.length) : Math.max(1, slot);

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - PAD.left;
    if (x < 0 || x > innerW) {
      setHover(null);
      return;
    }
    const index = Math.min(n - 1, Math.max(0, Math.floor(x / bandW)));
    setHover(index);
  };

  const zeroY = scaleY(0);

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${yLabel} por ${xLabel}`}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={0}
                x2={innerW}
                y1={scaleY(tick)}
                y2={scaleY(tick)}
                stroke="#27272a"
                strokeWidth={1}
              />
              <text
                x={-8}
                y={scaleY(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#71717a"
                fontSize={10}
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {bandPath && <path d={bandPath} fill={band?.color} opacity={0.18} />}

          {barSeries.map((s, si) => (
            <g key={s.name}>
              {s.values.map((value, index) => {
                if (typeof value !== "number" || !Number.isFinite(value)) return null;
                const y = scaleY(value);
                const top = Math.min(y, zeroY);
                const barH = Math.max(1, Math.abs(zeroY - y));
                const offset = grouped
                  ? scaleX(index) - (barW * barSeries.length) / 2 + si * barW
                  : scaleX(index) - barW / 2;
                return (
                  <rect
                    key={index}
                    x={offset}
                    y={top}
                    width={barW}
                    height={barH}
                    fill={s.color}
                    opacity={grouped ? 0.95 : si === 0 ? 0.85 : 0.6}
                  />
                );
              })}
            </g>
          ))}

          {series
            .filter((s) => s.type === "line")
            .map((s) => (
              <path
                key={s.name}
                d={linePath(s.values)}
                fill="none"
                stroke={s.color}
                strokeWidth={1.8}
                strokeDasharray={s.dashed ? "4 3" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#3f3f46" strokeWidth={1} />

          {xTickIndexes.map((index) => (
            <text
              key={index}
              x={scaleX(index)}
              y={innerH + 14}
              textAnchor="middle"
              fill="#71717a"
              fontSize={10}
            >
              {categories[index]}
            </text>
          ))}

          <text
            x={innerW / 2}
            y={innerH + 28}
            textAnchor="middle"
            fill="#52525b"
            fontSize={9}
          >
            {xLabel}
          </text>

          {hover !== null && (
            <line
              x1={scaleX(hover)}
              x2={scaleX(hover)}
              y1={0}
              y2={innerH}
              stroke="#a1a1aa"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </g>

        <text
          transform={`translate(12,${PAD.top + innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fill="#a1a1aa"
          fontSize={10}
        >
          {yLabel}
        </text>
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10px] text-zinc-400">
        {band && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ backgroundColor: band.color, opacity: 0.35 }}
            />
            {band.name}
          </span>
        )}
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{
                backgroundColor: s.type === "bar" ? s.color : "transparent",
                borderTop: s.type === "line" ? `2px ${s.dashed ? "dashed" : "solid"} ${s.color}` : undefined,
              }}
            />
            {s.name}
            {hover !== null && (
              <span className="font-mono text-zinc-200">
                {formatValue(s.values[hover])}
              </span>
            )}
          </span>
        ))}
        {hover !== null && (
          <span className="ml-auto font-mono text-zinc-300">{categories[hover]}</span>
        )}
      </div>
    </div>
  );
}

function formatValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
}
