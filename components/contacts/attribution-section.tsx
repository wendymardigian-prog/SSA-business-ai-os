import Link from "next/link";
import type { AttributionView, TouchView } from "@/lib/contacts/attribution-view";
import { EntryUrlBlock } from "@/components/attribution/entry-url-block";
import { EmptyHint, Section } from "./ui";

/**
 * Atribución del contacto (F88): de dónde vino y cómo volvió.
 *
 * Todo lo que decide qué se muestra vive en `lib/contacts/attribution-view.ts`;
 * esto solo lo compone. El PRIMER toque es el crédito de quien lo trajo y no
 * cambia; el ÚLTIMO es lo que lo trajo de vuelta. Con un solo toque se muestra
 * uno solo, porque dos tarjetas iguales parecen dos eventos. El camino completo
 * va plegado: es para quien lo quiere mirar, no para quien solo pasa.
 */
export function AttributionSection({ view, contactId }: { view: AttributionView; contactId?: string }) {
  return (
    <Section title="Atribución">
      {view.empty || !view.first ? (
        <EmptyHint>
          Sin datos de atribución. Se completan solos cuando el contacto escribe,
          comenta una publicación, reserva o llega desde un anuncio.
        </EmptyHint>
      ) : (
        <div className="space-y-3">
          <div className={view.last ? "grid gap-3 sm:grid-cols-2" : ""}>
            <TouchCard
              title={view.last ? "Primer toque" : "Único toque"}
              hint={view.last ? "No cambia nunca" : "Todavía no volvió a interactuar"}
              touch={view.first}
            />
            {view.last && (
              <TouchCard title="Último toque" hint="Se actualiza con cada interacción nueva" touch={view.last} />
            )}
          </div>

          {contactId && (
            <p className="text-xs">
              <Link href={`/dashboard/contacts/${contactId}/toques`} className="text-primary underline-offset-2 hover:underline">
                Ver todos los toques
              </Link>
            </p>
          )}

          {view.path.length > 1 && (
            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                Camino completo · {view.path.length} toques
              </summary>
              <ol className="space-y-1.5 border-t border-border px-3 py-2.5">
                {view.path.map((touch, index) => (
                  <li key={index} className="text-xs">
                    <TouchText touch={touch} />
                    {touch.entryUrl && <EntryUrlBlock url={touch.entryUrl} className="mt-1.5" />}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}

function TouchCard({ title, hint, touch }: { title: string; hint: string; touch: TouchView }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mb-2 text-xs text-muted-foreground/70">{hint}</p>
      <p className="text-sm">
        <TouchText touch={touch} />
      </p>
      <TouchDetail touch={touch} />
      {touch.entryUrl && <EntryUrlBlock url={touch.entryUrl} className="mt-2" />}
    </div>
  );
}

/** La línea del anuncio (con nombre y miniatura si hay catálogo), cómo se vinculó y, plegado, el detalle. */
function TouchDetail({ touch }: { touch: TouchView }) {
  if (!touch.adLine && !touch.matchNote && touch.details.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {touch.adLine && (
        <div className="flex items-center gap-2">
          {touch.adThumbnail && (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage con vencimiento: next/image no la puede optimizar.
            <img src={touch.adThumbnail} alt="" className="h-10 w-10 shrink-0 rounded-md border border-border object-cover" loading="lazy" />
          )}
          <p className="min-w-0 break-words text-xs text-muted-foreground">{touch.adLine}</p>
        </div>
      )}
      {touch.matchNote && <p className="text-[11px] text-muted-foreground/80">{touch.matchNote}</p>}
      {touch.details.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Ver detalle</summary>
          <dl className="mt-1.5 space-y-1">
            {touch.details.map((d) => (
              <div key={d.label} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{d.label}</dt>
                <dd className="min-w-0 break-all">{d.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

/** La frase del toque; si trae pieza y se conoce, su nombre lleva a ella. */
function TouchText({ touch }: { touch: TouchView }) {
  return (
    <span>
      <span className="font-medium">{touch.origin}</span>
      {touch.account && <span className="text-muted-foreground" title="Cuenta por la que entró"> · {touch.account}</span>}
      {touch.rawMedium && (
        <span className="text-muted-foreground" title="Este medio no es de la lista: se guardó tal cual llegó">
          {" "}
          (sin clasificar)
        </span>
      )}
      {touch.piece && (
        <>
          <span className="text-muted-foreground"> · </span>
          {touch.href ? (
            <Link href={touch.href} className="underline underline-offset-2 hover:text-foreground">
              «{touch.piece}»
            </Link>
          ) : (
            <span>«{touch.piece}»</span>
          )}
        </>
      )}
      {touch.when && <span className="text-muted-foreground"> · {touch.when}</span>}
    </span>
  );
}
