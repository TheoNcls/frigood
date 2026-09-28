import { api } from "../api/client";

/** Notifications push : abonnement de cet appareil (navigateur ou app de l'écran d'accueil). */

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // pas bloquant : seules les notifications en dépendent
    });
  });
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Sur iPhone, les notifications ne marchent que depuis l'app ajoutée à l'écran d'accueil. */
export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush(userId: number): Promise<void> {
  const { public_key } = await api<{ public_key: string | null }>("/push/config");
  if (!public_key) throw new Error("Les notifications ne sont pas encore configurées sur le serveur");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications refusées : autorise-les dans les réglages du téléphone");
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(public_key);
  let sub = await reg.pushManager.getSubscription();
  // Abonnement créé avec une autre clé serveur : on le refait
  const existingKey = sub?.options.applicationServerKey;
  if (sub && existingKey && new Uint8Array(existingKey).toString() !== key.toString()) {
    await sub.unsubscribe();
    sub = null;
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  } catch (e) {
    throw new Error(`Ce navigateur n'a pas pu s'abonner aux notifications (${e instanceof Error ? e.message : e})`);
  }
  await api(`/users/${userId}/push/subscriptions`, { method: "POST", body: sub.toJSON() });
}

export async function disablePush(userId: number): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api(`/users/${userId}/push/unsubscribe`, { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
