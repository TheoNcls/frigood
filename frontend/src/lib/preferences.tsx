import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Préférences propres à l'appareil (ex. pas de photos sur le téléphone pour économiser les données)
interface Preferences {
  showPhotos: boolean;
}

const DEFAULTS: Preferences = { showPhotos: true };
const STORAGE_KEY = "frigood_prefs";

function load(): Preferences {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

interface PreferencesValue extends Preferences {
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

const PreferencesContext = createContext<PreferencesValue>({ ...DEFAULTS, setPreference: () => {} });

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(load);

  const setPreference = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((current) => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // stockage indisponible : la préférence ne vaut que pour cette session
      }
      return next;
    });
  }, []);

  return <PreferencesContext.Provider value={{ ...prefs, setPreference }}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  return useContext(PreferencesContext);
}
