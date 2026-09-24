import { useState } from "react";

// Emoji de secours d'après la catégorie ou le nom (ingrédients sans photo : Claude, saisie manuelle)
const EMOJI_RULES: [RegExp, string][] = [
  [/boisson|eau|jus|soda|sirop|th[ée]|caf[ée]|lait (d'|de )?(amande|avoine|soja|riz|coco)|boissons/i, "🥤"],
  [/fromage|yaourt|yogourt|skyr|cr[èe]me|beurre|lait|laitier/i, "🧀"],
  [/[œo]euf/i, "🥚"],
  [/pain|biscotte|brioche|viennoiserie/i, "🍞"],
  [/p[âa]tes|riz|c[ée]r[ée]ale|avoine|flocon|muesli|quinoa|bl[ée]|semoule|farine/i, "🌾"],
  [/lentille|pois|haricot|l[ée]gumineuse|f[èe]ve|tofu|soja|tempeh|seitan/i, "🫘"],
  [/noix|amande|noisette|cacahu|graine|ol[ée]agineux|p[âa]te à tartiner/i, "🥜"],
  [/huile|mati[èe]re grasse|margarine/i, "🫒"],
  [/chocolat|bonbon|confiserie|sucr[ée]|biscuit|g[âa]teau|dessert|barre/i, "🍫"],
  [/[ée]pice|sel|poivre|sauce|condiment|herbe/i, "🌶️"],
  [/fruit|pomme|banane|orange|citron|fraise|poire|raisin|baie|agrume/i, "🍎"],
  [/l[ée]gume|salade|carotte|tomate|courgette|[ée]pinard|chou|oignon|poivron|brocoli/i, "🥬"],
  [/sardine|thon|poisson|jambon|poulet|viande|porc|b[œo]euf/i, "🍖"],
];

export function foodEmoji(nom: string, categorie?: string | null): string {
  const text = `${categorie ?? ""} ${nom}`;
  return EMOJI_RULES.find(([re]) => re.test(text))?.[1] ?? "🥗";
}

const SIZES = { sm: "h-9 w-9 text-lg", md: "h-12 w-12 text-2xl", lg: "h-28 w-28 text-5xl" } as const;

export default function FoodThumb({ nom, categorie, imageUrl, size = "sm", recipe = false }: {
  nom: string;
  categorie?: string | null;
  imageUrl?: string | null;
  size?: keyof typeof SIZES;
  recipe?: boolean;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const showImage = !!imageUrl && status !== "failed";

  // L'emoji reste visible tant que la photo n'est pas chargée : une image lente ou introuvable
  // (le serveur d'OpenFoodFacts ne répond parfois pas du tout) ne laisse jamais de case vide
  return (
    <span
      className={`${SIZES[size]} relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl ${
        status === "loaded" && showImage ? "bg-white ring-1 ring-slate-200" : "bg-slate-100"
      }`}
    >
      <span aria-hidden className={status === "loaded" && showImage ? "invisible" : ""}>
        {recipe ? "🍽️" : foodEmoji(nom, categorie)}
      </span>
      {showImage && (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
            status === "loaded" ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("failed")}
        />
      )}
    </span>
  );
}
