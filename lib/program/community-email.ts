// @plantilla-quitar(servicios)
/**
 * Una publicación de la comunidad convertida en HTML de email, pura (00405). Lee lo MISMO que la pantalla y el portal
 * (`communityBlocks`: Markdown acotado + links sueltos) y lo escribe con estilos en línea, como el resto de los emails
 * del sistema (`lib/email/templates.ts`): los clientes de correo no entienden CSS moderno.
 *
 * Seguridad: todo el texto se escapa; un link solo sale si ya pasó `safeHref` (http, https, mailto, tel). Nada del
 * cuerpo puede meter HTML propio. Los videos quedan como links (un email no reproduce video).
 */
import { communityBlocks, communityPlainText, type CommunityRun } from "@/lib/program/community-text";

export function escapeEmailText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const TEXT = "#374151";

function runHtml(run: CommunityRun, ink: string): string {
  let html = escapeEmailText(run.text).replace(/\n/g, "<br />");
  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.italic) html = `<em>${html}</em>`;
  if (run.href) html = `<a href="${escapeEmailText(run.href)}" target="_blank" style="color:${ink};text-decoration:underline;word-break:break-word;">${html}</a>`;
  return html;
}

const runs = (list: CommunityRun[], ink: string) => list.map((r) => runHtml(r, ink)).join("");

/** El cuerpo de la publicación en HTML de email. `ink` es el color de los links (ya legible sobre blanco). */
export function communityEmailHtml(body: string, opts: { ink: string }): string {
  return communityBlocks(body)
    .map((b) => {
      if (b.type === "heading") {
        const size = b.level === 1 ? 20 : b.level === 2 ? 18 : 16;
        return `<p style="margin:18px 0 6px;font-size:${size}px;line-height:1.35;font-weight:700;color:#111827;">${runs(b.runs, opts.ink)}</p>`;
      }
      if (b.type === "list") {
        const tag = b.ordered ? "ol" : "ul";
        const items = b.items.map((i) => `<li style="margin:0 0 4px;">${runs(i, opts.ink)}</li>`).join("");
        return `<${tag} style="margin:0 0 12px;padding:0 0 0 22px;font-size:15px;line-height:1.6;color:${TEXT};">${items}</${tag}>`;
      }
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${TEXT};">${runs(b.runs, opts.ink)}</p>`;
    })
    .join("\n");
}

/** La línea que muestra la bandeja al lado del asunto: el comienzo del texto, sin formato. */
export function communityEmailPreheader(body: string, max = 120): string {
  const plain = communityPlainText(body).replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** «Esta publicación tiene N fotos», o nada. */
export function communityPhotoLine(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? "Esta publicación tiene 1 foto." : `Esta publicación tiene ${Math.floor(count)} fotos.`;
}
