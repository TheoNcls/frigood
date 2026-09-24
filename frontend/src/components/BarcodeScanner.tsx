import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { CameraOff } from "lucide-react";

interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (!window.isSecureContext) return "La caméra n'est disponible qu'en https.";
  if (name === "NotAllowedError") return "Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, puis réessaie.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Aucune caméra trouvée sur cet appareil.";
  if (name === "NotReadableError") return "La caméra est déjà utilisée par une autre application.";
  return "Impossible de démarrer la caméra.";
}

/** Scan continu : appelle onDetected une seule fois, dès qu'un code EAN/UPC est lu. */
export default function BarcodeScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const [error, setError] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoom, setZoom] = useState(1);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
    ]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    let controls: IScannerControls | undefined;
    let cancelled = false;
    let done = false;

    reader
      .decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        videoRef.current!,
        (result, _err, ctrl) => {
          if (!result || done) return;
          done = true;
          ctrl.stop();
          navigator.vibrate?.(80);
          onDetectedRef.current(result.getText());
        },
      )
      .then((c) => {
        if (cancelled) {
          c.stop();
          return;
        }
        controls = c;
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        // Le zoom matériel n'existe que sur certains appareils (Android surtout)
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: ZoomRange }) | undefined;
        if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
          setZoomRange(caps.zoom);
          setZoom(caps.zoom.min);
        }
      })
      .catch((e) => !cancelled && setError(cameraError(e)));

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  function applyZoom(value: number) {
    setZoom(value);
    trackRef.current?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }).catch(() => {});
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">
        <CameraOff className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="aspect-video w-full object-cover" playsInline muted autoPlay />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-1/3 w-3/4 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      </div>
      {zoomRange && (
        <label className="flex items-center gap-3 text-sm text-slate-600">
          Zoom
          <input
            type="range"
            className="flex-1 accent-brand-600"
            min={zoomRange.min}
            max={zoomRange.max}
            step={zoomRange.step || 0.1}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
          />
        </label>
      )}
      <p className="text-xs text-slate-500">Place le code-barres dans le cadre : il est lu automatiquement.</p>
    </div>
  );
}
