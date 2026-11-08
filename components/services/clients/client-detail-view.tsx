// @plantilla-quitar(servicios)
"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, MessageCircle, Plus } from "lucide-react";
import { addClientComment } from "@/lib/actions/services";
import { clientTimelineFilter, type TimelineFilter } from "@/lib/services/screens/service";
import { LIGHT_LABELS, STATUS_LABELS, dayLabel, type Light, type ServiceStatus } from "@/lib/services/screens/list";
import { ActionError } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";
import { LightDot } from "./services-list-view";
import { NewServiceDialog, type NewServiceOptions } from "./new-service-dialog";
import { cn } from "@/lib/utils";

export interface ClientDetailData {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  clientSince: string | null;
  totalPaid: string;
  lastContact: string | null;
  services: Array<{ id: string; productName: string; variantName: string; status: ServiceStatus; light: Light | null; phaseName: string | null; startsOn: string | null; endsOn: string | null; createdAt: string }>;
  events: Array<{ id: string; at: string; serviceId: string | null; kind: string; text: string; author: string | null }>;
  firstSaleAt: string | null;
}

/**
 * La ficha del cliente (F28): cabecera, KPIs (servicios, total cobrado, último contacto), sus servicios y la
 * actividad con filtros (todo · por servicio · antes de la venta) y el compositor de comentario interno.
 */
export function ClientDetailView({ data, today, canCreate, newServiceOptions }: { data: ClientDetailData; today: string; canCreate: boolean; newServiceOptions: NewServiceOptions }) {
  const router = useRouter();
  const [filter, setFilter] = useState<TimelineFilter>({ kind: "all" });
  const [comment, setComment] = useState("");
  const [about, setAbout] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const events = useMemo(() => clientTimelineFilter(data.events, filter), [data.events, filter]);
  const filterKey = filter.kind === "service" ? `s:${filter.serviceId}` : filter.kind;

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
    <div className="flex h-full flex-col">
      <PageHeader
        title={data.name}
        tooltip="Todo lo de este cliente: sus servicios, lo que pagó y la actividad del equipo."
        backHref={
          <Link href="/dashboard/clientes/lista" aria-label="Volver a Clientes" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-8">
          <header className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary-ink" aria-hidden>
              {data.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{data.name}</h1>
              <p className="text-xs text-muted-foreground">
                {[data.email, data.phone, data.clientSince ? `Cliente desde ${data.clientSince.split("-").reverse().join("/")}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <Link href={`/dashboard/contacts/${data.contactId}`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent">
                Ficha del contacto
              </Link>
              {canCreate && (
                <button type="button" onClick={() => setCreating(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
                  <Plus className="h-4 w-4" aria-hidden />
                  Servicio
                </button>
              )}
            </div>
          </header>

          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-border p-3">
              <dt className="text-xs text-muted-foreground">Servicios</dt>
              <dd className="text-lg font-semibold">{data.services.length}</dd>
            </div>
            <div className="rounded-xl border border-border p-3">
              <dt className="text-xs text-muted-foreground">Total cobrado</dt>
              <dd className="text-lg font-semibold">{data.totalPaid}</dd>
            </div>
            <div className="rounded-xl border border-border p-3">
              <dt className="text-xs text-muted-foreground">Último contacto</dt>
              <dd className="text-lg font-semibold">{data.lastContact ? data.lastContact.slice(0, 10).split("-").reverse().join("/") : "—"}</dd>
            </div>
          </dl>

          <section aria-labelledby="sus-servicios" className="space-y-2">
            <h2 id="sus-servicios" className="text-sm font-semibold">
              Sus servicios
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.services.map((s) => (
                <li key={s.id}>
                  <Link href={`/dashboard/clientes/s/${s.id}`} className="block rounded-xl border border-border p-3 hover:bg-accent/40">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <LightDot light={s.light ?? "gray"} label={LIGHT_LABELS[s.light ?? "gray"]} />
                      {s.productName}
                      {s.variantName ? ` · ${s.variantName}` : ""}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {STATUS_LABELS[s.status]} · {s.phaseName ?? "—"} · {dayLabel(s, today)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="actividad" className="space-y-3">
            <h2 id="actividad" className="text-sm font-semibold">
              Actividad
            </h2>
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
                  className={cn("rounded-full border px-3 py-1 text-xs", filterKey === b.key ? "border-primary-edge bg-primary/10 text-primary-ink" : "border-border text-muted-foreground")}
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
                  <select value={about} onChange={(e) => setAbout(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground">
                    <option value="">el cliente</option>
                    {data.services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.productName}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={pending || !comment.trim()} onClick={send} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
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
                  <p>{e.text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.at.slice(0, 16).replace("T", " ")}
                    {e.author ? ` · ${e.author}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
      {creating && <NewServiceDialog options={newServiceOptions} preset={{ contactId: data.contactId, contactName: data.name }} onClose={() => setCreating(false)} />}
    </div>
  );
}
