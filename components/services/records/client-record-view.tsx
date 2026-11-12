// @plantilla-quitar(servicios)
"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Loader2, MessageCircle, Plus } from "lucide-react";
import { addClientComment } from "@/lib/actions/services";
import { clientTimelineFilter, type TimelineFilter } from "@/lib/services/screens/service";
import { LIGHT_LABELS, STATUS_LABELS, dayLabel, type Light, type ServiceStatus } from "@/lib/services/screens/list";
import { clientRecordFacts } from "@/lib/services/screens/client-record";
import { withRecord } from "@/lib/services/screens/record-url";
import { ActionError } from "@/components/contacts/ui";
import { InlineField } from "@/components/contacts/inline-field";
import { LightDot } from "@/components/services/clients/services-list-view";
import { NewServiceDialog, type NewServiceOptions } from "@/components/services/clients/new-service-dialog";
import { cn } from "@/lib/utils";
import { rememberRecordOpener } from "./record-modal";

export interface ClientRecordService {
  id: string;
  productName: string;
  variantName: string;
  status: ServiceStatus;
  light: Light | null;
  lightReason: string | null;
  phaseName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  progressPct: number;
  ownerName: string | null;
  createdAt: string;
  hasPortal: boolean;
}

export interface ClientRecordData {
  contactId: string;
  name: string;
  email: string;
  phone: string;
  whatsapp: string | null;
  avatarUrl: string | null;
  leadSince: string | null;
  clientSince: string | null;
  /** Lo cobrado de sus ventas, en centavos. Null sin ventas (no es un cero). */
  paidCents: number | null;
  lastContact: string | null;
  firstSaleAt: string | null;
  hasPortal: boolean;
  portal: { accountStatus: string | null; lastLoginAt: string | null; pendingReviews: number } | null;
  services: ClientRecordService[];
  events: Array<{ id: string; at: string; serviceId: string | null; kind: string; text: string; author: string | null }>;
}

const civil = new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const fmtCivil = (d: string | null) => (d ? civil.format(new Date(`${d.slice(0, 10)}T12:00:00Z`)) : "—");

export function ClientRecordHeader({ data, canEdit, canCreate, newServiceOptions, timeZone }: { data: ClientRecordData; canEdit: boolean; canCreate: boolean; newServiceOptions: NewServiceOptions; timeZone: string }) {
  const [creating, setCreating] = useState(false);
  const facts = clientRecordFacts(data, new Date().toISOString(), timeZone);
  const wa = data.whatsapp ? data.whatsapp.replace(/\D/g, "") : "";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3 pr-12">
        {data.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary-ink" aria-hidden>
            {(data.name || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <InlineField contactId={data.contactId} field="display_name" value={data.name} label="Nombre" variant="title" canEdit={canEdit} placeholder="Sin nombre" />
          <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            <InlineField contactId={data.contactId} field="email" value={data.email} label="Email" canEdit={canEdit} placeholder="Agregar email" href={data.email ? `mailto:${data.email}` : null} />
            <InlineField contactId={data.contactId} field="phone" value={data.phone} label="Teléfono" canEdit={canEdit} placeholder="Agregar teléfono" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent md:h-8">
              WhatsApp
            </a>
          )}
          <Link href={`/dashboard/contacts/${data.contactId}`} className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent md:h-8">
            Ficha del contacto
          </Link>
          {canCreate && (
            <button type="button" onClick={() => setCreating(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 md:h-8">
              <Plus className="h-4 w-4" aria-hidden /> Servicio
            </button>
          )}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Datos del cliente">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline gap-1.5">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
            <dd className={cn(f.tone === "bad" ? "text-bad" : f.tone === "warn" ? "text-warn" : undefined)}>{f.value}</dd>
          </div>
        ))}
      </dl>
      {creating && <NewServiceDialog options={newServiceOptions} preset={{ contactId: data.contactId, contactName: data.name }} onClose={() => setCreating(false)} />}
    </div>
  );
}

export function ClientRecordView({ data, today, timeZone, portalCard }: { data: ClientRecordData; today: string; timeZone: string; portalCard: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filter, setFilter] = useState<TimelineFilter>({ kind: "all" });
  const [comment, setComment] = useState("");
  const [about, setAbout] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const events = useMemo(() => clientTimelineFilter(data.events, filter), [data.events, filter]);
  const filterKey = filter.kind === "service" ? `s:${filter.serviceId}` : filter.kind;
  const current = data.services.filter((s) => s.status === "active" || s.status === "paused" || s.status === "pending_confirmation");
  const previous = data.services.filter((s) => !current.includes(s));
  const openService = (id: string) => withRecord(pathname, params?.toString() ?? "", { kind: "service", id });
  const when = (iso: string) => new Intl.DateTimeFormat("es", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  function send() {
    setError(null);
    start(async () => {
      const r = await addClientComment(data.contactId, about || null, comment);
      if (!r.ok) return setError(r.error.message);
      setComment("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <section aria-labelledby="cliente-servicios" className="space-y-2">
        <h3 id="cliente-servicios" className="text-sm font-semibold">
          Servicios <span className="text-xs font-normal text-muted-foreground">· {current.length} {current.length === 1 ? "activo" : "activos"}{previous.length ? ` · ${previous.length} ${previous.length === 1 ? "anterior" : "anteriores"}` : ""}</span>
        </h3>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {current.map((s) => {
            const light = (s.light ?? "gray") as Light;
            return (
              <li key={s.id} className={cn("grid gap-2 border-l-4 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center", light === "red" ? "border-l-bad" : light === "yellow" ? "border-l-warn" : light === "green" ? "border-l-good" : "border-l-border")}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.productName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.variantName ? `${s.variantName} · ` : ""}
                    {fmtCivil(s.startsOn)} → {s.endsOn ? fmtCivil(s.endsOn) : "sin fin"}
                  </p>
                  <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px]">{STATUS_LABELS[s.status]}</span>
                </div>
                <div className="min-w-0 text-xs">
                  <span className="flex items-center gap-1.5 text-sm">
                    <LightDot light={light} label={LIGHT_LABELS[light]} />
                    {LIGHT_LABELS[light]}
                  </span>
                  {s.lightReason && <span className="block truncate text-muted-foreground">{s.lightReason}</span>}
                </div>
                <div className="min-w-0 text-xs text-muted-foreground">
                  <span className="block text-sm text-foreground">
                    {s.phaseName ?? "Sin fase"} · {dayLabel(s, today)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, s.progressPct)}%` }} />
                    </span>
                    {Math.round(s.progressPct)} % · {s.ownerName ?? "Sin responsable"}
                  </span>
                  {s.hasPortal && data.portal && data.portal.pendingReviews > 0 && <span className="mt-1 inline-block rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">{data.portal.pendingReviews} por revisar</span>}
                </div>
                <Link href={openService(s.id)} scroll={false} onClick={(e) => rememberRecordOpener(e.currentTarget)} className="inline-flex min-h-10 items-center justify-self-start gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent md:min-h-8 md:justify-self-end">
                  Abrir <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </li>
            );
          })}
          {previous.map((s) => (
            <li key={s.id}>
              <Link href={openService(s.id)} scroll={false} onClick={(e) => rememberRecordOpener(e.currentTarget)} className="flex min-h-10 flex-wrap items-center gap-x-3 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/40">
                <span className="font-medium text-foreground">{s.productName}</span>
                {s.variantName && <span>{s.variantName}</span>}
                <span>
                  {fmtCivil(s.startsOn)} → {s.endsOn ? fmtCivil(s.endsOn) : "sin fin"}
                </span>
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5">{STATUS_LABELS[s.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {portalCard}

      <section aria-labelledby="cliente-actividad" className="space-y-3">
        <h3 id="cliente-actividad" className="text-sm font-semibold">
          Actividad
        </h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar la actividad">
          {[
            { key: "all", label: "Todo", f: { kind: "all" } as TimelineFilter },
            ...data.services.map((s) => ({ key: `s:${s.id}`, label: s.productName, f: { kind: "service", serviceId: s.id } as TimelineFilter })),
            { key: "before_sale", label: "Antes de la venta", f: { kind: "before_sale", firstSaleAt: data.firstSaleAt } as TimelineFilter },
          ].map((b) => (
            <button
              key={b.key}
              type="button"
              aria-pressed={filterKey === b.key}
              onClick={() => setFilter(b.f)}
              className={cn("min-h-10 rounded-full border px-3 text-xs md:min-h-7", filterKey === b.key ? "border-primary-edge bg-primary/10 text-primary-ink" : "border-border text-muted-foreground")}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label htmlFor="client-comment" className="sr-only">
            Comentario interno
          </label>
          <textarea id="client-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Comentario interno (no lo ve el cliente)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Comentar en
              <select value={about} onChange={(e) => setAbout(e.target.value)} className="h-10 rounded-lg border border-border bg-background px-2 text-xs text-foreground md:h-8">
                <option value="">el cliente</option>
                {data.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.productName}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={pending || !comment.trim()} onClick={send} className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 md:h-8">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <MessageCircle className="h-3.5 w-3.5" aria-hidden />}
              Comentar
            </button>
          </div>
          {error && <ActionError message={error} />}
        </div>
        <ol className="space-y-2">
          {events.length === 0 && <li className="text-sm text-muted-foreground">Sin actividad todavía.</li>}
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap">{e.text}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {when(e.at)}
                {e.author ? ` · ${e.author}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
