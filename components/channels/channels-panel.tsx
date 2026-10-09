"use client";

import { useState, useRef, useEffect } from "react";
import {
  Check,
  Copy,
  Plug,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Loader2,
  Trash2,
  QrCode,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { WhatsAppConnectModal } from "@/components/channels/whatsapp-connect-modal";
import { PlatformIcon } from "@/components/platform-icon";
import type { Database } from "@/lib/types/database";
import { CHANNELS_RETURN_KEY, returnTargetOrDefault } from "@/lib/channels/return-to";
import {
  PLATFORMS,
  PLATFORM_LABELS,
  platformLabel,
  type Platform,
} from "@/lib/platforms";
import { getDmLink } from "@/lib/contacts/links";

export type Channel = Database["public"]["Tables"]["channels"]["Row"];

/**
 * Los canales conectados, con Sincronizar y Conectar canal.
 *
 * Es el cuerpo de la pagina /dashboard/channels Y de la pestaña Cuentas de
 * Zernio y de Evolution en Integraciones: "cuentas" y "canales" son lo mismo,
 * asi que se ven en un solo lugar y con los mismos botones.
 *
 *  - `provider` = "zernio": solo los canales de Zernio, con Sincronizar y el
 *    selector de redes (sin WhatsApp ni email, que no pasan por Zernio).
 *  - `provider` = "evolution": solo WhatsApp, con su boton de QR (no hay
 *    sincronizar: Evolution reporta su estado en vivo).
 *  - sin `provider`: todos, como siempre (la pagina de canales).
 *
 * `returnTo` es a donde vuelve la persona despues de conectar una cuenta por
 * OAuth (ver lib/channels/return-to.ts).
 */
export function ChannelsPanel({
  channels: initialChannels,
  provider,
  returnTo,
}: {
  channels: Channel[];
  provider?: "zernio" | "evolution";
  returnTo?: string;
}) {
  const [channels, setChannels] = useState(initialChannels);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showPlatformPicker, setShowPlatformPicker] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [whatsappChannel, setWhatsappChannel] = useState<Channel | null>(null);
  const [connectingWhatsapp, setConnectingWhatsapp] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPlatformPicker(false);
      }
    }
    if (showPlatformPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showPlatformPicker]);

  async function handleConnect(platform: Platform) {
    setConnecting(platform);
    try {
      const res = await fetch("/api/v1/channels/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setSyncMessage(data.error || "No pude conectar");
        setTimeout(() => setSyncMessage(null), 4000);
        return;
      }

      if (data.authUrl) {
        // Recordar a donde volver: el callback sincroniza y redirige ahi.
        try {
          window.sessionStorage.setItem(CHANNELS_RETURN_KEY, returnTargetOrDefault(returnTo));
        } catch {
          // Sin sessionStorage (modo privado): vuelve a la pagina de canales.
        }
        window.location.href = data.authUrl;
      }
    } catch {
      setSyncMessage("No pude iniciar la conexión");
      setTimeout(() => setSyncMessage(null), 4000);
    } finally {
      setConnecting(null);
      setShowPlatformPicker(false);
    }
  }

  /**
   * WhatsApp no pasa por Zernio sino por Evolution API, asi que tiene su
   * propio flujo: se prepara la instancia en el servidor y despues se vincula
   * escaneando el QR. Es idempotente, asi que este mismo boton sirve para
   * conectar por primera vez y para reconectar despues de una caida.
   */
  async function handleConnectWhatsapp() {
    setConnectingWhatsapp(true);
    setShowPlatformPicker(false);
    try {
      const res = await fetch("/api/v1/channels/whatsapp", { method: "POST" });
      const data = await res.json();

      if (!res.ok || data.error) {
        setSyncMessage(data.error || "No pude preparar WhatsApp");
        setTimeout(() => setSyncMessage(null), 8000);
        return;
      }

      const channel: Channel = data.channel;
      setChannels((prev) => {
        const rest = prev.filter((c) => c.id !== channel.id);
        return [channel, ...rest];
      });
      setWhatsappChannel(channel);
    } catch {
      setSyncMessage("No pude contactar al servidor");
      setTimeout(() => setSyncMessage(null), 4000);
    } finally {
      setConnectingWhatsapp(false);
    }
  }

  function handleWhatsappConnected(channel: Channel) {
    setChannels((prev) => prev.map((c) => (c.id === channel.id ? channel : c)));
    setWhatsappChannel(channel);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);

    try {
      const res = await fetch("/api/v1/channels/sync", { method: "POST" });
      const data = await res.json();

      if (!res.ok || data.error) {
        setSyncMessage(data.error || "Falló la sincronización");
        return;
      }

      const syncedChannels: Channel[] = data.channels ?? [];
      setChannels(syncedChannels);
      const {
        created,
        updated,
        deactivated,
        conversationsImported = 0,
        failed = [],
        skipped = [],
      } = data.synced;
      const nothingChanged =
        created === 0 && updated === 0 && deactivated === 0 && conversationsImported === 0;

      // Si el webhook no se pudo registrar, no entra ni un mensaje: eso gana
      // sobre cualquier otro resultado del sync.
      const webhook = data.webhook as
        | { url?: string; action?: string; error?: string }
        | undefined;
      if (webhook?.error) {
        setWebhookError(webhook.error);
      } else {
        setWebhookError(null);
      }

      if (webhook?.error) {
        setSyncMessage(null);
      } else if (failed.length > 0) {
        setSyncMessage(`No pude guardar algunos canales: ${failed.join("; ")}`);
      } else if (nothingChanged && syncedChannels.length === 0 && skipped.length > 0) {
        setSyncMessage(
          `Nada para conectar: el sistema no soporta ${skipped.join(", ")}`
        );
      } else if (nothingChanged) {
        setSyncMessage("Todos los canales están al día");
      } else {
        const parts = [];
        if (created > 0) parts.push(`${created} agregados`);
        if (updated > 0) parts.push(`${updated} actualizados`);
        if (deactivated > 0) parts.push(`${deactivated} desactivados`);
        if (conversationsImported > 0) parts.push(`${conversationsImported} conversaciones importadas`);
        setSyncMessage(parts.join(", "));
      }
      setTimeout(() => setSyncMessage(null), failed.length > 0 ? 10000 : 4000);
    } catch {
      setSyncMessage("No pude sincronizar. Revisá tu conexión.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleActive(channel: Channel) {
    setTogglingId(channel.id);
    const supabase = createClient();

    const { error } = await supabase
      .from("channels")
      .update({ is_active: !channel.is_active })
      .eq("id", channel.id);

    if (!error) {
      setChannels((prev) =>
        prev.map((c) =>
          c.id === channel.id ? { ...c, is_active: !c.is_active } : c
        )
      );
    }
    setTogglingId(null);
  }

  async function handleDelete() {
    if (!channelToDelete) return;
    const id = channelToDelete.id;
    setChannelToDelete(null);
    setDeletingId(id);

    try {
      const res = await fetch(`/api/v1/channels/${id}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok || data.error) {
        setSyncMessage(data.error || "No pude eliminar el canal");
        setTimeout(() => setSyncMessage(null), 4000);
        return;
      }

      setChannels((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setSyncMessage("No pude eliminar el canal. Revisá tu conexión.");
      setTimeout(() => setSyncMessage(null), 4000);
    } finally {
      setDeletingId(null);
      setChannelToDelete(null);
    }
  }

  // Que canales se ven y que se puede conectar, segun el proveedor.
  const visibleChannels = provider ? channels.filter((c) => c.provider === provider) : channels;
  const connectablePlatforms =
    provider === "zernio" ? PLATFORMS.filter((p) => p !== "whatsapp" && p !== "email") : PLATFORMS;

  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {syncMessage && <span className="text-xs text-muted-foreground">{syncMessage}</span>}
      {provider !== "evolution" && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          {syncing ? "Sincronizando..." : "Sincronizar"}
        </button>
      )}
      {provider === "evolution" ? (
        <button
          onClick={handleConnectWhatsapp}
          disabled={connectingWhatsapp}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {connectingWhatsapp ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
          {visibleChannels.length > 0 ? "Reconectar WhatsApp" : "Conectar WhatsApp"}
        </button>
      ) : (
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setShowPlatformPicker(!showPlatformPicker)}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Conectar canal
          </button>
          {showPlatformPicker && (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-lg">
              {connectablePlatforms.map((p) => (
                <button
                  key={p}
                  onClick={() => (p === "whatsapp" ? handleConnectWhatsapp() : handleConnect(p))}
                  disabled={connecting === p || (p === "whatsapp" && connectingWhatsapp)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {connecting === p || (p === "whatsapp" && connectingWhatsapp) ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlatformIcon platform={p} className="h-4 w-4" size={16} />
                  )}
                  {PLATFORM_LABELS[p]}
                  {p === "whatsapp" && <span className="ml-auto text-[10px] text-muted-foreground">por QR</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="mb-4">{toolbar}</div>

      {/* Channel cards */}
      <div>
        {webhookError && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                No se pudo registrar el webhook: no van a entrar mensajes nuevos
              </p>
              <p className="mt-1 text-xs">{webhookError}</p>
            </div>
          </div>
        )}
        {visibleChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Plug className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              {provider === "evolution" ? "Todavía no hay un número de WhatsApp conectado" : "Todavía no hay canales"}
            </p>
            <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground/70">
              {provider === "evolution"
                ? "Vinculá tu WhatsApp escaneando un código QR desde el teléfono."
                : "Conectá una cuenta de redes sociales para empezar a armar flows y automatizar conversaciones."}
            </p>
            <button
              onClick={() => (provider === "evolution" ? handleConnectWhatsapp() : setShowPlatformPicker(true))}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" />
              {provider === "evolution" ? "Conectar WhatsApp" : "Conectar canal"}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleChannels.map((channel) => {
              const label = platformLabel(channel.platform);
              return (
                <div
                  key={channel.id}
                  className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {/* Avatar with platform badge */}
                      <div className="relative">
                        {channel.profile_picture ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={channel.profile_picture}
                              alt={channel.display_name ?? channel.username ?? label}
                              className="h-10 w-10 rounded-lg object-cover"
                            />
                            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-background">
                              <PlatformIcon
                                platform={channel.platform}
                                className="h-3 w-3"
                                size={12}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                            <PlatformIcon
                              platform={channel.platform}
                              className="h-5 w-5"
                            />
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-sm font-medium">
                          {channel.display_name ??
                            channel.username ??
                            label}
                        </p>
                        {channel.username && (
                          <p className="text-xs text-muted-foreground">
                            @{channel.username}
                          </p>
                        )}
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {label}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(channel)}
                        disabled={togglingId === channel.id}
                        className={cn(
                          "rounded-lg p-2 transition-colors",
                          channel.is_active
                            ? "text-green-600 hover:bg-green-100"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                        title={
                          channel.is_active
                            ? "El canal está activo. Click para desactivarlo."
                            : "El canal está inactivo. Click para activarlo."
                        }
                      >
                        {channel.is_active ? (
                          <Power className="h-4 w-4" />
                        ) : (
                          <PowerOff className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setChannelToDelete(channel)}
                        disabled={deletingId === channel.id}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-red-100 hover:text-red-600 transition-colors"
                        title="Eliminar canal"
                      >
                        {deletingId === channel.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* WhatsApp por Evolution reporta su estado real en vivo:
                      esta conectado o no, mas alla de que el canal este activo. */}
                  {channel.provider === "evolution" && (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            channel.connection_status === "connected"
                              ? "bg-green-100 text-green-700"
                              : channel.connection_status === "connecting"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              channel.connection_status === "connected"
                                ? "bg-green-500"
                                : channel.connection_status === "connecting"
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            )}
                          />
                          {channel.connection_status === "connected"
                            ? "Conectado"
                            : channel.connection_status === "connecting"
                              ? "Conectando"
                              : "Desconectado"}
                        </span>
                        <button
                          onClick={() => setWhatsappChannel(channel)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
                        >
                          <QrCode className="h-3 w-3" />
                          {channel.connection_status === "connected"
                            ? "Ver QR"
                            : "Reconectar"}
                        </button>
                      </div>
                      {channel.connection_status !== "connected" && channel.last_error && (
                        <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{channel.last_error}</span>
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        channel.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          channel.is_active
                            ? "bg-green-500"
                            : "bg-muted-foreground"
                        )}
                      />
                      {channel.is_active ? "Activo" : "Inactivo"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Conectado el{" "}
                      {new Date(channel.created_at).toLocaleDateString("es-AR", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>

                  {(() => {
                    if (channel.provider === "evolution") return null;
                    const dm = getDmLink(channel.platform as Platform, channel.username);
                    if (!dm.url) return null;
                    return (
                      <div className="mt-3 flex items-center gap-1.5">
                        <a
                          href={dm.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1 text-[11px] font-mono text-primary hover:underline"
                          title={dm.url}
                        >
                          {dm.label}
                        </a>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(dm.url!);
                            setCopiedId(channel.id);
                            setTimeout(() => setCopiedId(null), 2000);
                          }}
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                            copiedId === channel.id
                              ? "border-green-200 bg-green-50 text-green-600"
                              : "border-border bg-card text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                          )}
                          title={copiedId === channel.id ? "¡Copiado!" : "Copiar link de DM"}
                        >
                          {copiedId === channel.id ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {whatsappChannel && (
        <WhatsAppConnectModal
          channel={whatsappChannel}
          onConnected={handleWhatsappConnected}
          onClose={() => setWhatsappChannel(null)}
        />
      )}

      <ConfirmDialog
        open={!!channelToDelete}
        title="¿Eliminar canal?"
        message={`Esto desconecta a ${
          channelToDelete?.display_name ??
          channelToDelete?.username ??
          (channelToDelete ? platformLabel(channelToDelete.platform) : "este canal")
        } del proveedor y borra para siempre sus conversaciones, vínculos de contacto y estadísticas en el sistema. No se puede deshacer.`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setChannelToDelete(null)}
      />
    </div>
  );
}
