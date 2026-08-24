import type { FencePurpose } from "./types";

export type { FencePurpose };

export const FENCE_SPECIES = [
  {
    id: "gliricidia",
    name: "Madero negro (Gliricidia sepium)",
    spacing_m: 0.5,
    rows: 1,
  },
  {
    id: "erythrina",
    name: "Poró (Erythrina poeppigiana)",
    spacing_m: 1.0,
    rows: 1,
  },
  {
    id: "leucaena",
    name: "Leucaena (Leucaena leucocephala)",
    spacing_m: 0.5,
    rows: 1,
  },
  {
    id: "bursera",
    name: "Indio desnudo (Bursera simaruba)",
    spacing_m: 1.5,
    rows: 1,
  },
  { id: "bamboo", name: "Bambú", spacing_m: 1.0, rows: 2 },
  { id: "mixed", name: "Mixto multi-estrato", spacing_m: 1.0, rows: 2 },
] as const;

export const FENCE_PURPOSES: { id: FencePurpose; label: string }[] = [
  { id: "lindero", label: "Lindero" },
  { id: "potrero", label: "División de potrero" },
  { id: "cortavientos", label: "Corta-vientos" },
  { id: "multifuncional", label: "Multi-estrato" },
];
