import { useEffect, useState } from "react";
import { DAY_LABELS } from "../lib/habits";
import { currentSubscription } from "../lib/push";
import { useToast } from "./Toast";

/** Les 7 jours en ligne : surligné = l'habitude a lieu ce jour-là. */
export function DaysPicker({ value, onChange, disabled = false }: { value: number[]; onChange: (days: number[]) => void; disabled?: boolean }) {
  const toast = useToast();
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Jours de l'habitude">
      {DAY_LABELS.map((label, d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => {
              if (on && value.length === 1) return toast("Garde au moins un jour", "error");
              onChange(on ? value.filter((x) => x !== d) : [...value, d].sort());
            }}
            className={`rounded-lg py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
              on ? "bg-brand-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Interrupteur on/off (active / en pause). */
export function ToggleSwitch({ label, checked, disabled = false, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-100" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
    </label>
  );
}

/** Les notifications sont-elles activées sur cet appareil ? (pour prévenir que le rappel n'arrivera pas) */
export function usePushActive(): boolean | null {
  const [active, setActive] = useState<boolean | null>(null);
  useEffect(() => {
    currentSubscription().then((s) => setActive(!!s)).catch(() => setActive(false));
  }, []);
  return active;
}
