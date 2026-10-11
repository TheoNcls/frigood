import { useState } from "react";
import { Copy } from "lucide-react";
import { useToast } from "./Toast";

/**
 * Copie un texte préparé par le serveur. Sur iPhone (Safari), l'écriture doit partir du clic lui-même :
 * le presse-papiers reçoit donc une promesse du texte, avant même la réponse du serveur.
 */
async function copyFromServer(load: () => Promise<string>): Promise<{ ok: boolean; text: string }> {
  const pending = load();
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": pending.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return { ok: true, text: await pending };
    } catch {
      // Navigateur qui refuse ce mode : on retente avec le texte reçu
    }
  }
  const text = await pending;
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, text };
  } catch {
    return { ok: false, text };
  }
}

/** « Copier le texte pour une autre IA » : le texte complet envoyé au coach, à coller dans ChatGPT, Claude.ai, Gemini… */
export default function CopyPromptButton({ load, label = "Copier le texte pour une autre IA", className = "btn-secondary" }: {
  load: () => Promise<string>;
  label?: string;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);

  async function copy() {
    setBusy(true);
    try {
      const { ok, text } = await copyFromServer(load);
      if (ok) {
        setFallback(null);
        toast("Texte copié : colle-le dans l'IA de ton choix");
      } else {
        setFallback(text);
        toast("Copie impossible ici : sélectionne le texte affiché", "error");
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={copy}>
        <Copy className="h-4 w-4" /> {busy ? "Préparation du texte…" : label}
      </button>
      {fallback !== null && (
        <textarea
          readOnly
          className="input mt-2 min-h-[10rem] w-full basis-full font-mono text-[11px]"
          value={fallback}
          aria-label="Texte pour une autre IA"
          onFocus={(e) => e.target.select()}
        />
      )}
    </>
  );
}
