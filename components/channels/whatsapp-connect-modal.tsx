"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Smartphone, X, CheckCircle2 } from "lucide-react";
import type { Database } from "@/lib/types/database";

type Channel = Database["public"]["Tables"]["channels"]["Row"];

/** El QR de WhatsApp caduca; Evolution genera uno nuevo cada ~30 segundos. */
const POLL_MS = 4000;
/** Consultas seguidas sin codigo (≈20 s) para dar el QR por trabado. */
const MAX_POLLS_WITHOUT_QR = 5;
/** Un QR vivo cambia cada ~30 s: si es el mismo durante mas de esto, Evolution dejo de renovarlo. */
const STALE_QR_MS = 90_000;

interface QrResponse {
  state?: "open" | "close" | "connecting" | "unknown";
  /** El nombre nuevo del canal (con el numero vinculado), si cambio al conectar. */
  displayName?: string | null;
  qr?: { base64: string | null; code: string | null; pairingCode: string | null } | null;
  error?: string;
}

/**
 * Modal de vinculacion de WhatsApp.
 *
 * Pide el QR cada pocos segundos hasta que Evolution informa que la sesion
 * quedo abierta. Ese momento es el unico en que se puede dar por conectado:
 * escanear no es instantaneo y el QR se renueva solo.
 */
export function WhatsAppConnectModal({
  channel,
  onConnected,
  onClose,
}: {
  channel: Channel;
  onConnected: (channel: Channel) => void;
  onClose: () => void;
}) {
  const [qr, setQr] = useState<QrResponse["qr"]>(null);
  const [state, setState] = useState<QrResponse["state"]>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** El QR vencio y Evolution no genera otro solo: hay que pedirle uno nuevo (reconectar la MISMA instancia). */
  const [expired, setExpired] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const connectedRef = useRef(false);
  const pollsWithoutQrRef = useRef(0);
  const expiredRef = useRef(false);
  const lastQrRef = useRef<{ base64: string; since: number } | null>(null);

  const poll = useCallback(async () => {
    if (expiredRef.current) return;
    try {
      const res = await fetch(`/api/v1/channels/whatsapp/${channel.id}/qr`, {
        cache: "no-store",
      });
      const data: QrResponse = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? "No pude traer el codigo QR");
        return;
      }

      setError(null);
      setState(data.state);
      setQr(data.qr ?? null);

      if (data.state !== "open") {
        const base64 = data.qr?.base64 ?? null;
        const now = Date.now();
        if (!base64) {
          pollsWithoutQrRef.current += 1;
        } else {
          pollsWithoutQrRef.current = 0;
          if (lastQrRef.current?.base64 !== base64) lastQrRef.current = { base64, since: now };
        }
        const stuck =
          pollsWithoutQrRef.current >= MAX_POLLS_WITHOUT_QR ||
          (!!lastQrRef.current && now - lastQrRef.current.since > STALE_QR_MS);
        if (stuck) {
          expiredRef.current = true;
          setExpired(true);
        }
      }

      if (data.state === "open" && !connectedRef.current) {
        connectedRef.current = true;
        onConnected({
          ...channel,
          display_name: data.displayName ?? channel.display_name,
          connection_status: "connected",
          is_active: true,
          last_error: null,
        });
      }
    } catch {
      setError("No pude contactar al servidor. Revisa tu conexion.");
    } finally {
      setLoading(false);
    }
  }, [channel, onConnected]);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  /**
   * Pide un QR nuevo para ESTE numero: es el mismo POST que el boton "Reconectar" (con el channelId), que reusa la
   * instancia y la destraba si hace falta. Nunca agrega otro numero.
   */
  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/channels/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: channel.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "No pude generar un código nuevo. Probá de nuevo en un minuto.");
        return;
      }
      pollsWithoutQrRef.current = 0;
      lastQrRef.current = null;
      expiredRef.current = false;
      setExpired(false);
      setQr(null);
      setLoading(true);
      await poll();
    } catch {
      setError("No pude contactar al servidor. Revisa tu conexion.");
    } finally {
      setRegenerating(false);
    }
  }

  // Cerrar con Escape, como cualquier modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const connected = state === "open";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="wa-modal-title" className="text-lg font-semibold">
              Conectar WhatsApp
            </h2>
            {channel.display_name && (
              <p className="mt-0.5 text-sm font-medium">{channel.display_name}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {connected
                ? "Listo, tu WhatsApp quedo vinculado."
                : "Escanea el codigo con el telefono que va a atender los mensajes."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex min-h-[280px] flex-col items-center justify-center">
          {connected ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="text-sm font-medium">WhatsApp conectado</p>
              <button
                onClick={onClose}
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Cerrar
              </button>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {error}
              </p>
              <button
                onClick={() => {
                  // Con el QR vencido, consultar de nuevo no alcanza: hay que pedir uno nuevo.
                  if (expiredRef.current) return void regenerate();
                  setLoading(true);
                  poll();
                }}
                disabled={regenerating}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                Reintentar
              </button>
            </div>
          ) : expired ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <Smartphone className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">El código venció</p>
              <p className="text-xs text-muted-foreground">
                WhatsApp dejó de generar códigos para este número. Pedí uno nuevo y escanealo.
              </p>
              <button
                onClick={regenerate}
                disabled={regenerating}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Generar un código nuevo
              </button>
            </div>
          ) : loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : qr?.base64 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr.base64}
                alt="Codigo QR para vincular WhatsApp"
                className="h-56 w-56 rounded-lg border border-border bg-white p-2"
              />
              {qr.pairingCode && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  O vincula por codigo:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {qr.pairingCode}
                  </span>
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <Smartphone className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                Generando el codigo...
              </p>
            </div>
          )}
        </div>

        {!connected && (
          <ol className="mt-5 space-y-1.5 rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground">
            <li>1. Abri WhatsApp en el telefono</li>
            <li>2. Menu (o Ajustes) → Dispositivos vinculados</li>
            <li>3. Vincular un dispositivo</li>
            <li>4. Apunta la camara a este codigo</li>
          </ol>
        )}

        {!connected && (
          <p className="mt-3 text-center text-[10px] text-muted-foreground/70">
            El codigo se renueva solo cada pocos segundos. Deja esta ventana abierta.
          </p>
        )}
      </div>
    </div>
  );
}
