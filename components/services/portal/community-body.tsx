// @plantilla-quitar(servicios)
import { Fragment, type ReactNode } from "react";
import { communityBlocks, communityVideos, type CommunityRun, type CommunityVideo } from "@/lib/program/community-text";

/**
 * Una publicación de la comunidad dibujada: el Markdown acotado (títulos, negrita, cursiva, listas y links), los
 * reproductores de los links de video y las fotos. Nunca mete HTML: cada tramo es texto que React escapa.
 */
export function CommunityBody({ body, photos = [], videos = true, compact = false }: { body: string; photos?: string[]; videos?: boolean; compact?: boolean }) {
  const blocks = communityBlocks(body);
  const players = videos ? communityVideos(body) : [];
  return (
    <div className="space-y-2">
      <div className={compact ? "space-y-1 text-sm" : "space-y-2 text-sm"}>
        {blocks.map((b, i) => {
          if (b.type === "heading") {
            const cls = b.level === 1 ? "text-lg font-bold" : b.level === 2 ? "text-base font-bold" : "text-sm font-semibold";
            const Tag = (`h${b.level + 1}` as "h2" | "h3" | "h4");
            return <Tag key={i} className={`${cls} pt-1`}>{runs(b.runs)}</Tag>;
          }
          if (b.type === "list") {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List key={i} className={b.ordered ? "list-decimal space-y-0.5 pl-6" : "list-disc space-y-0.5 pl-6"}>
                {b.items.map((item, k) => <li key={k}>{runs(item)}</li>)}
              </List>
            );
          }
          return <p key={i} className="break-words">{runs(b.runs)}</p>;
        })}
      </div>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((url, n) => (
            <a key={n} href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Foto ${n + 1}`} loading="lazy" className={photos.length === 1 ? "max-h-80 max-w-full object-contain" : "h-32 w-32 object-cover"} />
            </a>
          ))}
        </div>
      )}
      {players.length > 0 && <CommunityVideoPlayers videos={players} />}
    </div>
  );
}

const PROVIDER = { youtube: "YouTube", vimeo: "Vimeo", loom: "Loom", drive: "Drive", fathom: "Fathom" } as const;

/** Los reproductores de los links de video (debajo de un post, o en el editor antes de publicar). */
export function CommunityVideoPlayers({ videos }: { videos: CommunityVideo[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {videos.map((v) => (
        <div key={v.embedUrl} className={videos.length === 1 ? "max-w-xl sm:col-span-2" : ""}>
          <div className="aspect-video overflow-hidden rounded-lg border border-border bg-black">
            <iframe
              src={v.embedUrl}
              title={`Video de ${PROVIDER[v.provider]}`}
              loading="lazy"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function runs(list: CommunityRun[]): ReactNode {
  return list.map((r, i) => {
    let node: ReactNode = r.text.split("\n").map((line, k) => (
      <Fragment key={k}>
        {k > 0 && <br />}
        {line}
      </Fragment>
    ));
    if (r.italic) node = <em>{node}</em>;
    if (r.bold) node = <strong className="font-semibold">{node}</strong>;
    if (r.href) node = <a href={r.href} target="_blank" rel="noopener noreferrer" className="break-all text-primary-ink underline underline-offset-2">{node}</a>;
    return <Fragment key={i}>{node}</Fragment>;
  });
}
