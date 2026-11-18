"use client";
// @plantilla-quitar(servicios)

import { useRef, useState, type ReactNode } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import type { JSONContent } from "@tiptap/react";
import { RichTextEditor, type RichTextFormat } from "@/components/editor/rich-text-editor";
import { CommunityVideoPlayers } from "@/components/services/portal/community-body";
import { FieldEmojiButton } from "@/components/ui/emoji-picker";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { communityUploadPhoto } from "@/lib/actions/community";
import { COMMUNITY_TITLE_MAX, communityFromEditorDoc, communityToEditorDoc, communityVideos, looksLikeMarkdown, MAX_COMMUNITY_PHOTOS } from "@/lib/program/community-text";

/** Lo guardado es Markdown acotado; un Markdown pegado como texto se abre con su formato. */
const COMMUNITY_FORMAT: RichTextFormat = {
  load: (value) => communityToEditorDoc(value) as JSONContent,
  save: (doc) => communityFromEditorDoc(doc as never),
  pasteText: (text) => (looksLikeMarkdown(text) ? (communityToEditorDoc(text) as JSONContent) : null),
  // Un Markdown pegado se lee de su texto plano aunque venga con HTML: así no se pierden los saltos de línea.
  pasteTextOverHtml: true,
};

/** El título de un post del equipo (00405), con su botón de emojis. Va arriba del editor. */
export function CommunityTitleField({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={COMMUNITY_TITLE_MAX}
        placeholder="Título"
        aria-label="Título"
        disabled={disabled}
        className={cn(fieldInput, "flex-1 text-base font-semibold")}
      />
      <FieldEmojiButton targetId={id} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export interface ComposerPhoto {
  path: string;
  url: string;
}

/**
 * Escribir (o editar) una publicación con formato: el editor, las fotos y cómo se van a ver los videos de los links.
 * Lo de abajo (espacio, «Como…», botones) lo pone quien lo usa en `footer`.
 */
export function CommunityComposer({
  id,
  productId,
  body,
  onBody,
  photos,
  onPhotos,
  footer,
  disabled,
  header,
}: {
  id: string;
  productId: string;
  body: string;
  onBody: (body: string) => void;
  photos: ComposerPhoto[];
  /** Recibe una función (lo de antes → lo nuevo): las fotos llegan de a una mientras se suben. */
  onPhotos: (update: (prev: ComposerPhoto[]) => ComposerPhoto[]) => void;
  /** Lo de abajo; `uploading` = hay fotos subiendo (no se publica hasta que terminen). */
  footer: (state: { uploading: boolean }) => ReactNode;
  disabled?: boolean;
  /** Lo de arriba del editor (el título). */
  header?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videos = communityVideos(body);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = MAX_COMMUNITY_PHOTOS - photos.length - uploading;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (list.length < files.length) setError(`Hasta ${MAX_COMMUNITY_PHOTOS} fotos por publicación`);
    setUploading((n) => n + list.length);
    for (const file of list) {
      const fd = new FormData();
      fd.set("productId", productId);
      fd.set("file", file);
      const r = await communityUploadPhoto(fd);
      setUploading((n) => n - 1);
      if (!r.ok) setError(r.error.message);
      else onPhotos((prev) => [...prev, r.data].slice(0, MAX_COMMUNITY_PHOTOS));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      {header}
      <RichTextEditor
        id={id}
        label="Publicación"
        value={body}
        onChange={onBody}
        format={COMMUNITY_FORMAT}
        underline={false}
        minHeight={140}
        disabled={disabled}
        extraToolbar={() => (
          <button
            type="button"
            aria-label="Agregar fotos"
            title="Agregar fotos"
            disabled={disabled || photos.length >= MAX_COMMUNITY_PHOTOS}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        )}
      />
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => upload(e.target.files)} />
      {(photos.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={p.path} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Foto ${i + 1}`} className="h-20 w-20 rounded-lg border border-border object-cover" />
              <button type="button" aria-label={`Quitar la foto ${i + 1}`} onClick={() => onPhotos((prev) => prev.filter((x) => x.path !== p.path))} className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 shadow-sm hover:bg-accent">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <div key={`up${i}`} className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground" aria-label="Subiendo foto">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{videos.length === 1 ? "El video del link se va a ver así:" : "Los videos de los links se van a ver así:"}</p>
          <CommunityVideoPlayers videos={videos} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">Enter: párrafo nuevo · Shift+Enter: renglón nuevo sin espacio · Enter dos veces: renglón vacío</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">{footer({ uploading: uploading > 0 })}</div>
    </div>
  );
}
