import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { ErrorMessage, Field, Segmented } from "../components/ui";

function numOrNull(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function Login() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nom, setNom] = useState("");
  const [targets, setTargets] = useState({ cal: "2000", prot: "60", gluc: "250", lip: "65" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (tab === "login") {
        await login(email, password);
      } else {
        await register({
          nom: nom.trim(),
          email: email.trim(),
          password,
          calories_cible: numOrNull(targets.cal),
          proteines_cible: numOrNull(targets.prot),
          glucides_cible: numOrNull(targets.gluc),
          lipides_cible: numOrNull(targets.lip),
        });
      }
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-5xl" aria-hidden>🥦</div>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Frigood</h1>
          <p className="mt-1 text-sm text-slate-500">Ta nutrition végétarienne, ton frigo et ton sport</p>
        </div>

        <form onSubmit={submit} className="card space-y-4">
          <div className="flex justify-center">
            <Segmented
              value={tab}
              onChange={(v) => { setTab(v); setError(null); }}
              options={[{ value: "login", label: "Connexion" }, { value: "register", label: "Créer un compte" }]}
            />
          </div>

          {tab === "register" && (
            <Field label="Nom">
              <input className="input" required value={nom} onChange={(e) => setNom(e.target.value)} autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Mot de passe" hint={tab === "register" ? "8 caractères minimum" : undefined}>
            <input
              className="input"
              type="password"
              required
              minLength={tab === "register" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === "login" ? "current-password" : "new-password"}
            />
          </Field>

          {tab === "register" && (
            <div>
              <div className="label">Objectifs nutritionnels quotidiens</div>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ["cal", "Calories (kcal)"], ["prot", "Protéines (g)"], ["gluc", "Glucides (g)"], ["lip", "Lipides (g)"],
                ] as const).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={targets[key]}
                      onChange={(e) => setTargets({ ...targets, [key]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}

          <ErrorMessage error={error} />

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? "…" : tab === "login" ? "Se connecter" : "Créer mon compte"}
          </button>
        </form>
      </div>
    </div>
  );
}
