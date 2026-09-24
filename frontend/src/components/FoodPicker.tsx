import { useMemo, useState } from "react";
import { Barcode, Search } from "lucide-react";
import { sortByUsage } from "../lib/usage";

interface Item {
  id: number;
  nom: string;
}

export default function FoodPicker<T extends Item>({ label, items, counts, inFridge, value, onChange, onScan }: {
  label: string;
  items: T[];
  counts: Map<number, number>;
  inFridge?: Set<number>;
  value: number | null;
  onChange: (id: number) => void;
  onScan?: () => void;
}) {
  const [search, setSearch] = useState("");

  const options = useMemo(() => {
    const s = search.trim().toLowerCase();
    const filtered = s ? items.filter((i) => i.nom.toLowerCase().includes(s)) : items;
    return sortByUsage(filtered, counts);
  }, [items, counts, search]);

  const selectedVisible = options.some((o) => o.id === value);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0">{label}</span>
        {onScan && (
          <button type="button" className="btn-ghost py-1 text-brand-700" onClick={onScan}>
            <Barcode className="h-4 w-4" /> Scanner
          </button>
        )}
      </div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Rechercher…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            const s = e.target.value.trim().toLowerCase();
            const first = sortByUsage(items.filter((i) => i.nom.toLowerCase().includes(s)), counts)[0];
            if (first) onChange(first.id);
          }}
        />
      </div>
      <select
        className="input"
        value={selectedVisible ? value ?? "" : ""}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {!selectedVisible && <option value="" disabled>{options.length ? "Choisir…" : "Aucun résultat"}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {inFridge?.has(o.id) ? "🧊 " : ""}{o.nom}
          </option>
        ))}
      </select>
    </div>
  );
}
