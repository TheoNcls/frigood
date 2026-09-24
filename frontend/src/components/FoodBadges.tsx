import type { GreenScore, Nova, NutriScore, Regime } from "../api/types";

export const GREENSCORE_LABELS: Record<GreenScore, string> = {
  "a-plus": "A+", a: "A", b: "B", c: "C", d: "D", e: "E", f: "F",
};

const GREENSCORE_COLORS: Record<GreenScore, string> = {
  "a-plus": "#0b6b37", a: "#1e8f4e", b: "#60ac0e", c: "#eeae0e", d: "#ff6f1e", e: "#df1f1f", f: "#8f1515",
};

// Couleurs officielles du Nutri-Score
const NUTRISCORE_COLORS: Record<NutriScore, string> = {
  a: "#038141", b: "#85BB2F", c: "#FECB02", d: "#EE8100", e: "#E63E11",
};

const NOVA_STYLES: Record<Nova, { cls: string; label: string }> = {
  1: { cls: "bg-emerald-100 text-emerald-800", label: "Brut ou peu transformé" },
  2: { cls: "bg-lime-100 text-lime-800", label: "Ingrédient culinaire" },
  3: { cls: "bg-amber-100 text-amber-800", label: "Transformé" },
  4: { cls: "bg-red-100 text-red-800", label: "Ultra-transformé" },
};

export const REGIME_INFO: Record<Regime, { cls: string; icon: string; label: string }> = {
  vegan: { cls: "bg-emerald-100 text-emerald-800", icon: "🌱", label: "Végan" },
  vegetarien: { cls: "bg-lime-100 text-lime-800", icon: "🥚", label: "Végétarien" },
  non_vegetarien: { cls: "bg-red-100 text-red-800", icon: "⚠️", label: "Non végétarien" },
  incertain: { cls: "bg-amber-100 text-amber-800", icon: "❓", label: "Végétarien ?" },
};

export function NutriScoreBadge({ grade }: { grade: NutriScore | null }) {
  if (!grade) return null;
  const light = grade === "c";
  return (
    <span
      className="badge font-bold uppercase"
      style={{ background: NUTRISCORE_COLORS[grade], color: light ? "#3f3f00" : "white" }}
      title={`Nutri-Score ${grade.toUpperCase()}`}
    >
      Nutri {grade}
    </span>
  );
}

export function GreenScoreBadge({ grade }: { grade: GreenScore | null }) {
  if (!grade) return null;
  const label = GREENSCORE_LABELS[grade];
  return (
    <span
      className="badge font-bold"
      style={{ background: GREENSCORE_COLORS[grade], color: grade === "c" ? "#3f3000" : "white" }}
      title={`Green-Score ${label} (impact environnemental)`}
    >
      🌍 {label}
    </span>
  );
}

export function NovaBadge({ nova }: { nova: Nova | null }) {
  if (!nova) return null;
  const s = NOVA_STYLES[nova];
  return <span className={`badge ${s.cls}`} title={`NOVA ${nova} : ${s.label}`}>NOVA {nova}</span>;
}

export function RegimeBadge({ regime, compact = false }: { regime: Regime | null; compact?: boolean }) {
  if (!regime) return null;
  const r = REGIME_INFO[regime];
  return <span className={`badge ${r.cls}`} title={r.label}>{r.icon}{compact ? "" : ` ${r.label}`}</span>;
}

export function FoodBadges({ item, compact = false }: {
  item: { nutriscore: NutriScore | null; greenscore: GreenScore | null; nova: Nova | null; regime: Regime | null };
  compact?: boolean;
}) {
  if (!item.nutriscore && !item.greenscore && !item.nova && !item.regime) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <RegimeBadge regime={item.regime} compact={compact} />
      <NutriScoreBadge grade={item.nutriscore} />
      <GreenScoreBadge grade={item.greenscore} />
      <NovaBadge nova={item.nova} />
    </span>
  );
}
