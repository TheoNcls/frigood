import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { fmt } from "../lib/nutrition";

export function Card({ title, children, className = "", action }: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="card-title mb-0">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function ProgressBar({ value, max, over = false }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(value / max, 1) * 100 : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-all ${over ? "bg-red-500" : "bg-brand-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function MacroTile({ label, value, target, unit, showRemaining = false }: {
  label: string;
  value: number;
  target: number | null;
  unit: string;
  showRemaining?: boolean;
}) {
  const hasTarget = !!target && target > 0;
  const remaining = hasTarget ? target - value : 0;
  const over = hasTarget && remaining < 0;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-900">
        <span className="text-xl font-semibold">{fmt(value)}</span>
        {hasTarget && <span className="text-sm text-slate-500"> / {fmt(target)} {unit}</span>}
        {!hasTarget && <span className="text-sm text-slate-500"> {unit}</span>}
      </div>
      {hasTarget && <ProgressBar value={value} max={target} over={over} />}
      {hasTarget && showRemaining && (
        <div className={`text-xs ${over ? "text-red-600" : "text-emerald-600"}`}>
          {fmt(Math.abs(remaining))} {unit} {over ? "de trop" : "restant(e)s"}
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-slate-500">{children}</p>;
}

export function Segmented<T extends string>({ value, options, onChange, full = false }: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`segmented ${full ? "flex w-full" : ""}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={full ? "flex-1" : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
