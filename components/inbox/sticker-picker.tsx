"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Star, Sticker, Trash2, Upload } from "lucide-react";
import { deleteSticker, listStickers, setStickerFavorite } from "@/lib/actions/stickers";
import { defaultStickerTab, stickersForTab, type StickerTab, type StickerWithUrl } from "@/lib/stickers/format";
import { cn } from "@/lib/utils";

const TABS: { key: StickerTab; label: string }[] = [
  { key: "favorites", label: "Favoritos" },
  { key: "recent", label: "Recientes" },
  { key: "all", label: "Todos" },
];

/**
 * El selector de stickers del composer (00257). Solo aparece en chats de un
 * canal que los admite (lib/channels/stickers.ts): hoy, WhatsApp.
 *
 * Clic en un sticker = mandarlo. La estrella lo marca como favorito; el tacho
 * (con `templates.manage`) lo saca de la biblioteca. "Subir" acepta PNG, JPG,
 * WEBP o GIF: el servidor lo convierte en sticker (un GIF queda animado).
 *
 * WhatsApp no deja leer los stickers guardados en el celular: la biblioteca se
 * arma sola con los que se mandan (desde acá o desde el teléfono) y con los
 * que se guardan de un chat.
 */
export function StickerPicker({
  onPick,
  canDelete,
  disabled,
  disabledReason,
}: {
  onPick: (stickerId: string) => void;
  canDelete: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [stickers, setStickers] = useState<StickerWithUrl[] | null>(null);
  const [tab, setTab] = useState<StickerTab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const result = await listStickers();
    if (!result.ok) {
      setError(result.error);
      setStickers([]);
      return;
    }
    setStickers(result.stickers);
    setTab((current) => current ?? defaultStickerTab(result.stickers));
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    if (next) {
      setError(null);
      void load();
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/stickers", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "No pude subir el sticker.");
        return;
      }
      setTab("all");
      await load();
    } catch {
      setError("No pude subir el sticker. Probá de nuevo.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function favorite(sticker: StickerWithUrl) {
    const next = !sticker.isFavorite;
    setStickers((prev) => prev?.map((s) => (s.id === sticker.id ? { ...s, isFavorite: next } : s)) ?? prev);
    const result = await setStickerFavorite({ stickerId: sticker.id, favorite: next });
    if (!result.ok) {
      setError(result.error);
      setStickers((prev) => prev?.map((s) => (s.id === sticker.id ? { ...s, isFavorite: !next } : s)) ?? prev);
    }
  }

  async function remove(sticker: StickerWithUrl) {
    const result = await deleteSticker({ stickerId: sticker.id });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStickers((prev) => prev?.filter((s) => s.id !== sticker.id) ?? prev);
  }

  const shown = stickers && tab ? stickersForTab(stickers, tab) : [];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Stickers"
        title={disabled ? disabledReason ?? "Stickers" : "Stickers"}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <Sticker className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Stickers"
          className="absolute bottom-full right-0 z-50 mb-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-popover p-2 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 pb-2">
            <div role="tablist" aria-label="Qué stickers ver" className="inline-flex rounded-lg border border-border p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn("rounded-md px-2 py-1 text-xs font-medium", tab === t.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
              Subir
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              aria-label="Subir un sticker"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>

          {stickers === null ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando stickers" />
            </div>
          ) : shown.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 px-4 text-center">
              <p className="text-sm font-medium">{tab === "favorites" ? "Todavía no hay favoritos" : "Todavía no hay stickers"}</p>
              <p className="text-xs text-muted-foreground">
                {tab === "favorites"
                  ? "Tocá la estrella de un sticker para tenerlo acá."
                  : "Se suman solos cuando mandás uno (también desde el celular). Podés guardar los que te mandan o subir una imagen o un GIF."}
              </p>
            </div>
          ) : (
            <ul className="grid max-h-72 grid-cols-4 gap-1 overflow-y-auto" aria-label="Stickers">
              {shown.map((sticker) => (
                <li key={sticker.id} className="group/item relative">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onPick(sticker.id);
                    }}
                    aria-label={sticker.isAnimated ? "Mandar sticker animado" : "Mandar sticker"}
                    className="flex aspect-square w-full items-center justify-center rounded-lg p-1 hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
                    <img src={sticker.url ?? undefined} alt="" loading="lazy" className="h-full w-full object-contain" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void favorite(sticker)}
                    aria-label={sticker.isFavorite ? "Quitar de favoritos" : "Marcar como favorito"}
                    aria-pressed={sticker.isFavorite}
                    className={cn(
                      "absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5",
                      sticker.isFavorite ? "text-amber-500" : "text-muted-foreground opacity-0 group-hover/item:opacity-100 focus:opacity-100",
                    )}
                  >
                    <Star className="h-3 w-3" fill={sticker.isFavorite ? "currentColor" : "none"} aria-hidden />
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(sticker)}
                      aria-label="Sacar de la biblioteca"
                      className="absolute bottom-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 hover:text-red-600 focus:opacity-100 group-hover/item:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
