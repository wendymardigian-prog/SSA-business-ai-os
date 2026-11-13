"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { disconnectGoogleDrive, disconnectYouTubeChannel } from "@/lib/actions/google-connections";
import { YouTubeProbeFooter } from "./youtube-probe-footer";
import type { GoogleServicesSummary, YouTubeChannelSummary } from "./types";

/** A donde vuelve Google despues de conectar (tiene que estar en la lista de `safeRedirect`). */
const BACK = "/dashboard/settings/integrations/google?tab=cuentas";

const startHref = (provider: "google" | "google_drive") =>
  `/api/oauth/${provider}/start?redirect_to=${encodeURIComponent(BACK)}`;

/**
 * La pestaña Cuentas de Google (00374): los canales de YouTube del negocio
 * (varios, como las cuentas de Instagram), su Google Drive (una cuenta) y un
 * acceso al Calendar de cada persona, que se conecta desde Agenda.
 *
 * Conectar es un link y no un boton: el navegador tiene que ir a Google, y la
 * cookie del `state` se pone en esa misma respuesta (lib/oauth/flow.ts).
 */
export function GoogleAccountsPanel({
  google,
  calendarPeople,
  credentialsReady,
}: {
  google: GoogleServicesSummary | undefined;
  calendarPeople: number;
  /** Client ID y Secret guardados: sin ellos no se puede ir a Google. */
  credentialsReady: boolean;
}) {
  const channels = google?.youtube ?? [];
  const drive = google?.drive ?? null;

  return (
    <div className="space-y-8">
      {!credentialsReady && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          Para conectar YouTube o Drive, primero guardá el Client ID y el Secret en la pestaña Credenciales.
        </p>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Canales de YouTube</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Son del negocio, no de una persona. Podés conectar varios: Google te deja elegir la cuenta y, si la
              cuenta maneja más de un canal (canales de marca), cuál.
            </p>
          </div>
          {credentialsReady && (
            <a
              href={startHref("google")}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {channels.length === 0 ? "Conectar un canal" : "Conectar otro canal"}
            </a>
          )}
        </div>

        {channels.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Todavía no hay ningún canal de YouTube conectado.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {channels.map((channel) => (
              <ChannelRow key={channel.connectionId} channel={channel} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="text-sm font-medium">Google Drive</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Una cuenta por negocio. Sirve para importar archivos en Recursos, como archivo o como enlace. El sistema
          solo ve los archivos que elijas en la ventana de Google, nunca el Drive entero.
        </p>
        {drive ? (
          <DriveRow drive={drive} reconnectHref={startHref("google_drive")} />
        ) : (
          credentialsReady && (
            <a
              href={startHref("google_drive")}
              className="mt-3 inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              Conectar Google Drive
            </a>
          )
        )}
        {drive && !google?.pickerReady && (
          <p className="mt-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            Para abrir Drive desde Recursos faltan la API key y el número del proyecto de Google Cloud. Cargalos en la
            pestaña Credenciales.
          </p>
        )}
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Qué hay que activar en Google Cloud (una sola vez)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>APIs y servicios → Biblioteca: activar «Google Drive API» y «Google Picker API».</li>
            <li>Pantalla de consentimiento → Permisos: agregar «…/auth/drive.file».</li>
            <li>Credenciales → Crear credenciales → Clave de API. Restringila a la Google Picker API y pegala en Credenciales.</li>
            <li>El número del proyecto está en el panel principal del proyecto (solo dígitos).</li>
          </ol>
        </details>
      </section>

      <section>
        <p className="text-sm font-medium">Google Calendar</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {calendarPeople === 0
            ? "Nadie lo conectó todavía."
            : calendarPeople === 1
              ? "1 persona lo conectó."
              : `${calendarPeople} personas lo conectaron.`}{" "}
          Cada persona conecta su propio calendario desde Agenda.
        </p>
        <Link href="/dashboard/agenda/configuracion/calendarios" className="mt-1 inline-block text-xs underline">
          Ir a Agenda → Calendarios
        </Link>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Desconectar acá borra el acceso del sistema. Para quitarle el permiso también del lado de Google, entrá a
        myaccount.google.com/permissions con esa cuenta.
      </p>
    </div>
  );
}

function ChannelRow({ channel }: { channel: YouTubeChannelSummary }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const broken = channel.status !== "active";

  function disconnect() {
    setError(null);
    start(async () => {
      const result = await disconnectYouTubeChannel(channel.connectionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        {channel.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto del canal, de los servidores de Google
          <img src={channel.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded-full bg-muted" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{channel.label}</p>
          <p
            className={`text-xs ${broken ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {broken ? (channel.lastError ?? "Necesita atención") : "Conectado"}
          </p>
        </div>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="h-8 shrink-0 rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
          >
            Desconectar
          </button>
        )}
      </div>

      {broken && (
        <a href={startHref("google")} className="mt-2 inline-block text-xs underline">
          Reconectar este canal
        </a>
      )}

      {confirming && (
        <div className="mt-3 rounded-lg bg-muted/50 p-3">
          <p className="text-xs">
            Se deja de publicar y de leer métricas de «{channel.label}». Lo programado por la API de YouTube en este
            canal se desprograma. Su historial queda.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={disconnect}
              disabled={pending}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-60"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Sí, desconectar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-8 rounded-lg border border-border px-3 text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {!broken && !confirming && (
        <YouTubeProbeFooter verifiedAt={channel.verifiedAt} channelId={channel.channelId} compact />
      )}
    </li>
  );
}

function DriveRow({
  drive,
  reconnectHref,
}: {
  drive: NonNullable<GoogleServicesSummary["drive"]>;
  reconnectHref: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const broken = drive.status !== "active";

  function disconnect() {
    setError(null);
    start(async () => {
      const result = await disconnectGoogleDrive();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{drive.label}</p>
          <p
            className={`text-xs ${broken ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {broken ? (drive.lastError ?? "Necesita atención") : "Conectado"}
          </p>
        </div>
        <a href={reconnectHref} className="h-8 shrink-0 rounded-lg border border-border px-2.5 text-xs leading-8 hover:bg-muted">
          Cambiar cuenta
        </a>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="h-8 shrink-0 rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
          >
            Desconectar
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 rounded-lg bg-muted/50 p-3">
          <p className="text-xs">
            Recursos deja de poder importar de Drive. Lo que ya importaste queda: los archivos copiados siguen
            andando y los enlaces abren para quien tenga acceso en Drive.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={disconnect}
              disabled={pending}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-60"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Sí, desconectar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-8 rounded-lg border border-border px-3 text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
