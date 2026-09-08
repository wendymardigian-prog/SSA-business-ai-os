import { TRACKING_KEYS, type Attribution, type AttributionClick } from "@/lib/contacts/attribution";
import { EmptyHint, Section, formatDateTime } from "./ui";

/**
 * Atribucion del contacto (F10): de donde vino.
 *
 * first_click es el credito de quien lo trajo y no cambia nunca; last_click es
 * la ultima campaña que lo toco. Se muestran los dos porque responden
 * preguntas distintas: "quien lo consiguio" y "que lo trajo de vuelta".
 */

const LABELS: Record<string, string> = {
  utm_source: "Origen (utm_source)",
  utm_medium: "Medio (utm_medium)",
  utm_campaign: "Campaña (utm_campaign)",
  utm_term: "Termino (utm_term)",
  utm_content: "Contenido (utm_content)",
  fbclid: "Click ID de Meta",
  gclid: "Click ID de Google",
  ad_id: "Aviso",
  campaign_id: "ID de campaña",
  adset_id: "ID de conjunto",
  referrer_url: "Vino de",
  landing_page: "Aterrizo en",
};

export function AttributionSection({ attribution }: { attribution: Attribution }) {
  const { first_click: first, last_click: last } = attribution;

  return (
    <Section title="Atribución">
      {!first && !last ? (
        <EmptyHint>
          Sin datos de atribución. Se completan solos cuando el lead llega desde
          un aviso o una landing con parámetros de seguimiento (UTMs, fbclid,
          gclid).
        </EmptyHint>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <ClickCard title="Primer contacto" hint="No cambia nunca" click={first} />
          <ClickCard title="Último contacto" hint="Se actualiza en cada interacción" click={last} />
        </div>
      )}
    </Section>
  );
}

function ClickCard({
  title,
  hint,
  click,
}: {
  title: string;
  hint: string;
  click: AttributionClick | undefined;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mb-2 text-xs text-muted-foreground/70">{hint}</p>

      {!click ? (
        <p className="text-sm text-muted-foreground/60">Sin datos</p>
      ) : (
        <dl className="space-y-1">
          {TRACKING_KEYS.filter((key) => click[key]).map((key) => (
            <div key={key} className="flex items-start justify-between gap-3">
              <dt className="text-xs text-muted-foreground">{LABELS[key] ?? key}</dt>
              <dd className="min-w-0 break-all text-right text-xs font-medium">
                {click[key]}
              </dd>
            </div>
          ))}
          {click.captured_at && (
            <div className="flex items-start justify-between gap-3 border-t border-border pt-1">
              <dt className="text-xs text-muted-foreground">Capturado</dt>
              <dd className="text-right text-xs">{formatDateTime(click.captured_at)}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
