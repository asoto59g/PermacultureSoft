import type { BoqLine, FenceFeature, PipeFeature, RoadFeature } from "./types";

export type BoqCategory = "water" | "access" | "fences";

export type PriceBook = Record<string, number>;

export type AggregatedBoqRow = BoqLine & {
  key: string;
  edited: boolean;
};

export type AggregatedBoq = {
  rows: AggregatedBoqRow[];
  byCategory: Record<BoqCategory, number>;
  costRefUsd: number;
  areaHa: number | null;
  usdPerHa: number | null;
};

export function priceKey(item: string, unit: string): string {
  return `${item}|${unit}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Priced = { boq?: BoqLine[] };

function addSource(
  buckets: Map<string, AggregatedBoqRow>,
  source: Priced,
  prices: PriceBook
) {
  for (const line of source.boq || []) {
    const key = priceKey(line.item, line.unit);
    const unitPrice = prices[key] ?? line.unit_price;
    const prev = buckets.get(key);
    if (prev) {
      prev.qty = round2(prev.qty + line.qty);
      prev.unit_price = unitPrice;
      prev.edited = key in prices;
      prev.total = round2(prev.qty * unitPrice);
    } else {
      buckets.set(key, {
        item: line.item,
        qty: round2(line.qty),
        unit: line.unit,
        unit_price: unitPrice,
        total: round2(line.qty * unitPrice),
        key,
        edited: key in prices,
      });
    }
  }
}

function sourceTotal(source: Priced, prices: PriceBook): number {
  let sum = 0;
  for (const line of source.boq || []) {
    const key = priceKey(line.item, line.unit);
    sum += line.qty * (prices[key] ?? line.unit_price);
  }
  return round2(sum);
}

export function aggregateProjectBoq(
  pipes: PipeFeature[],
  roads: RoadFeature[],
  fences: FenceFeature[],
  prices: PriceBook,
  areaHa: number | null
): AggregatedBoq {
  const buckets = new Map<string, AggregatedBoqRow>();
  for (const p of pipes) addSource(buckets, p, prices);
  for (const r of roads) addSource(buckets, r, prices);
  for (const f of fences) addSource(buckets, f, prices);
  const rows = [...buckets.values()];
  const byCategory: Record<BoqCategory, number> = {
    water: round2(pipes.reduce((s, p) => s + sourceTotal(p, prices), 0)),
    access: round2(roads.reduce((s, r) => s + sourceTotal(r, prices), 0)),
    fences: round2(fences.reduce((s, f) => s + sourceTotal(f, prices), 0)),
  };
  const costRefUsd = round2(rows.reduce((s, r) => s + r.total, 0));
  const ha = areaHa != null && areaHa > 0.01 ? areaHa : null;
  return {
    rows,
    byCategory,
    costRefUsd,
    areaHa: ha,
    usdPerHa: ha ? round2(costRefUsd / ha) : null,
  };
}

export function downloadBoqCsv(boq: AggregatedBoq, label: string) {
  const lines = [
    "partida,cantidad,unidad,precio_unitario_usd,total_usd",
    ...boq.rows.map(
      (r) =>
        `"${r.item.replace(/"/g, '""')}",${r.qty},${r.unit},${r.unit_price},${r.total}`
    ),
    `"Total ref.",,,,${boq.costRefUsd}`,
  ];
  if (boq.usdPerHa != null) {
    lines.push(`"USD/ha",,,,${boq.usdPerHa}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `boq-${label || "proyecto"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parsePriceBook(raw: unknown): PriceBook {
  if (!raw || typeof raw !== "object") return {};
  const out: PriceBook = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (key && Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}
