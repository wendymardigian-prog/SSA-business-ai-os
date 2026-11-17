// @plantilla-quitar(servicios)
/**
 * El link de video de una clase (F46), puro: reconoce YouTube, Vimeo, Loom, Drive y Fathom y da el link para
 * incrustar (o por qué no se puede). Una carpeta de Drive o un video de Fathom no se incrustan: se avisa.
 */
export type VideoProvider = "youtube" | "vimeo" | "loom" | "drive" | "fathom";

export type VideoUrlResult =
  | { ok: true; provider: VideoProvider; embedUrl: string | null; thumbnailUrl: string | null; warning: string | null }
  | { ok: false; error: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function normalizeVideoUrl(raw: string): VideoUrlResult {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Pegá el link completo del video (empieza con https://)" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "El link tiene que empezar con https://" };
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] || null;
    else if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
    if (!id || !YT_ID.test(id)) return { ok: false, error: "No encontré el video en ese link de YouTube" };
    return { ok: true, provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, warning: null };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?/);
    if (!m) return { ok: false, error: "No encontré el video en ese link de Vimeo" };
    const hash = m[2] ?? u.searchParams.get("h");
    return { ok: true, provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${m[1]}${hash ? `?h=${hash}` : ""}`, thumbnailUrl: null, warning: null };
  }
  if (host === "loom.com") {
    const m = u.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{20,40})/);
    if (!m) return { ok: false, error: "No encontré el video en ese link de Loom" };
    // La miniatura de Loom no se puede armar desde el id (la de «-00001.jpg» da 403): la trae `videoMeta` (oEmbed).
    return { ok: true, provider: "loom", embedUrl: `https://www.loom.com/embed/${m[1]}`, thumbnailUrl: null, warning: null };
  }
  if (host === "drive.google.com") {
    if (u.pathname.startsWith("/drive/folders/") || u.pathname.startsWith("/drive/u/")) return { ok: false, error: "Esto es una carpeta de Drive: pegá el link de un archivo de video" };
    const m = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})/) ?? null;
    const id = m ? m[1] : u.pathname === "/open" ? u.searchParams.get("id") : null;
    if (!id) return { ok: false, error: "No encontré el archivo en ese link de Drive" };
    return { ok: true, provider: "drive", embedUrl: `https://drive.google.com/file/d/${id}/preview`, thumbnailUrl: null, warning: "El archivo tiene que estar compartido como «Cualquiera con el link»." };
  }
  if (host === "fathom.video") {
    if (!/^\/(?:share|calls)\//.test(u.pathname)) return { ok: false, error: "No encontré la grabación en ese link de Fathom" };
    return { ok: true, provider: "fathom", embedUrl: null, thumbnailUrl: null, warning: "Fathom no deja reproducir su video dentro de otra página: el portal muestra el botón «Ver la grabación»." };
  }
  return { ok: false, error: "Ese link no es de YouTube, Vimeo, Loom, Drive ni Fathom" };
}

/** El id de un video de Loom a partir del link para incrustar (`https://www.loom.com/embed/<id>`). */
export function loomIdFromEmbed(embedUrl: string | null | undefined): string | null {
  const m = /^https:\/\/www\.loom\.com\/embed\/([0-9a-f]{20,40})$/.exec(embedUrl ?? "");
  return m ? m[1] : null;
}

/** La dirección del oEmbed de Loom para un id ya validado. */
export function loomOembedUrl(id: string): string {
  return `https://www.loom.com/v1/oembed?url=${encodeURIComponent(`https://www.loom.com/share/${id}`)}`;
}

/** Lo que sirve del oEmbed de Loom: la miniatura (solo de su CDN, por https) y la duración en segundos. */
export function parseLoomOembed(body: unknown): { thumbnailUrl: string | null; durationSeconds: number | null } {
  const o = (body && typeof body === "object" ? body : {}) as { thumbnail_url?: unknown; duration?: unknown };
  const t = typeof o.thumbnail_url === "string" && /^https:\/\/cdn\.loom\.com\/[^\s"'<>]+$/.test(o.thumbnail_url) && o.thumbnail_url.length <= 500 ? o.thumbnail_url : null;
  const d = typeof o.duration === "number" && Number.isFinite(o.duration) && o.duration > 0 && o.duration < 86_400 ? Math.round(o.duration) : null;
  return { thumbnailUrl: t, durationSeconds: d };
}
