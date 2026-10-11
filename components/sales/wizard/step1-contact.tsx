"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Plus, Search, X } from "lucide-react";
import { createContactForSale, searchContactsForSale, type SaleContactContext } from "@/lib/actions/sales";
import { AttributionField } from "@/components/sales/attribution-field";
import { useContactSearchWith } from "@/components/sales/use-contact-search";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { draftAttributionType, type Step1Result } from "@/lib/sales/wizard/step1";
import type { AttributionFieldState } from "@/lib/sales/attribution-field";
import { eligibleBookings } from "@/lib/sales/booking-link";
import { formatCallDate } from "@/lib/calls/format";
import { saleStatusLabel } from "@/lib/sales/labels";
import type { WizardConfig, WizardMember } from "./types";

export interface Step1Values {
  contact: { id: string; name: string } | null;
  setterId: string | null;
  vendedorId: string | null;
  attribution: AttributionFieldState;
  saleDate: string;
  notes: string;
  bookingId: string | null;
}

const ATTRIBUTION_TYPE_TEXT = { last_touch: "último toque", manual: "cargada a mano", none: "sin atribución" } as const;

/** Paso 1: contacto, asignaciones, atribución y datos de la venta. */
export function Step1Contact({
  config,
  values,
  onChange,
  onContact,
  contactContext,
  loadingContext,
  validation,
  lockedContact,
}: {
  config: WizardConfig;
  values: Step1Values;
  onChange: (patch: Partial<Step1Values>) => void;
  onContact: (contact: { id: string; name: string } | null) => void;
  contactContext: SaleContactContext | null;
  loadingContext: boolean;
  validation: Step1Result;
  lockedContact: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const errors = Object.fromEntries(validation.errors.map((e) => [e.field, e.message]));

  return (
    <div className="space-y-4">
      {validation.warnings.map((w) => (
        <p key={w.kind} role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
          {w.text}
        </p>
      ))}

      <section aria-label="Contacto" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacto</h3>
        {values.contact ? (
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{values.contact.name}</span>
            {loadingContext && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
            {!lockedContact && (
              <button type="button" onClick={() => onContact(null)} aria-label="Cambiar de contacto" className="rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        ) : creating ? (
          <QuickCreate onCancel={() => setCreating(false)} onCreated={(c) => { setCreating(false); onContact(c); }} />
        ) : (
          <ContactSearch onPick={onContact} onCreate={() => setCreating(true)} />
        )}
      </section>

      <section aria-label="Asignaciones" className="grid gap-3 sm:grid-cols-2">
        <MemberSelect label="Setter" hint="Quien contactó al lead" value={values.setterId} members={config.members} onChange={(v) => onChange({ setterId: v })} />
        <MemberSelect label="Vendedor" hint="Quien cierra la venta" value={values.vendedorId} members={config.members} onChange={(v) => onChange({ vendedorId: v })} />
      </section>
      {!config.hasAllScope && (
        <p className="text-xs text-muted-foreground">Tenés que quedar como setter o como vendedor: si no, no podrías ver la venta que cargás.</p>
      )}

      <section aria-label="Atribución" className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">De dónde vino</h3>
        <AttributionField contactId={values.contact?.id ?? null} value={values.attribution} onChange={(a) => onChange({ attribution: a })} timeZone={config.timeZone} disabled={!values.contact} />
        {contactContext && (
          <p className="text-[11px] text-muted-foreground">
            Va a quedar como: {ATTRIBUTION_TYPE_TEXT[draftAttributionType(values.attribution, contactContext.touchCount)]}.
          </p>
        )}
      </section>

      <section aria-label="Datos de la venta" className="grid gap-3 sm:grid-cols-2">
        <DialogField label="Fecha de la venta">
          <input type="date" className={fieldInput} value={values.saleDate} max={config.today} onChange={(e) => onChange({ saleDate: e.target.value })} />
          {errors.saleDate && <span className="block text-[11px] text-red-700 dark:text-red-400">{errors.saleDate}</span>}
        </DialogField>
        <BookingSelect context={contactContext} value={values.bookingId} members={config.members} timeZone={config.timeZone} onChange={(id) => onChange({ bookingId: id })} />
        <div className="sm:col-span-2">
          <DialogField label="Notas internas" hint="Solo las ve el equipo">
            <textarea className={fieldInput} rows={2} maxLength={2000} value={values.notes} onChange={(e) => onChange({ notes: e.target.value })} />
          </DialogField>
        </div>
      </section>
    </div>
  );
}

function MemberSelect({ label, hint, value, members, onChange }: { label: string; hint: string; value: string | null; members: WizardMember[]; onChange: (v: string | null) => void }) {
  return (
    <DialogField label={label} hint={hint}>
      <select className={fieldInput} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Sin asignar</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </DialogField>
  );
}

function BookingSelect({ context, value, members, timeZone, onChange }: { context: SaleContactContext | null; value: string | null; members: WizardMember[]; timeZone: string; onChange: (id: string | null) => void }) {
  const now = new Date();
  const past = eligibleBookings(
    (context?.bookings ?? []).map((b) => ({ id: b.id, contact_id: "x", start_at: b.startAt, status: b.status, host_user_id: b.hostUserId, event_type_title: b.eventTypeTitle })),
    "x",
    now,
  );
  const host = (id: string | null) => members.find((m) => m.id === id)?.name ?? null;
  return (
    <DialogField label="Agenda que originó esta venta" hint={context && past.length === 0 ? "Este contacto no tiene agendas pasadas" : undefined}>
      <select className={fieldInput} value={value ?? ""} disabled={!context || past.length === 0} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Ninguna</option>
        {past.map((b) => (
          <option key={b.id} value={b.id}>
            {formatCallDate(b.start_at, timeZone)} · {b.event_type_title ?? "Agenda"}{host(b.host_user_id) ? ` · ${host(b.host_user_id)}` : ""} · {b.status}
          </option>
        ))}
      </select>
    </DialogField>
  );
}

export function ContactSearch({ onPick, onCreate }: { onPick: (c: { id: string; name: string }) => void; onCreate: () => void }) {
  const search = useContactSearchWith(async (q) => (await searchContactsForSale(q)).map((c) => ({ id: c.id, name: c.name, email: c.email ?? c.phone })));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          placeholder="Buscar por nombre, email, teléfono o usuario"
          aria-label="Buscar contacto"
          className={`${fieldInput} pl-8`}
        />
        {search.searching && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {search.options.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border" role="listbox" aria-label="Contactos encontrados">
          {search.options.map((o) => (
            <li key={o.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { onPick({ id: o.id, name: o.name }); search.reset(); }} className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="font-medium">{o.name}</span>
                {o.email && <span className="text-xs text-muted-foreground">{o.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.query.trim().length >= 2 && !search.searching && search.options.length === 0 && <p className="text-xs text-muted-foreground">No encontré a nadie con eso.</p>}
      <button type="button" onClick={onCreate} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent">
        <Plus className="h-3.5 w-3.5" aria-hidden /> Crear contacto
      </button>
    </div>
  );
}

function QuickCreate({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: { id: string; name: string }) => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const r = await createContactForSale({ name: form.name, email: form.email || undefined, phone: form.phone || undefined });
      if (!r.ok) return setError(r.error);
      if (r.notice) {
        setNotice(r.notice);
      }
      onCreated({ id: r.contactId, name: form.name.trim() || "Contacto" });
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <DialogField label="Nombre"><input className={fieldInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></DialogField>
        <DialogField label="Email"><input type="email" className={fieldInput} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></DialogField>
        <DialogField label="Teléfono"><input type="tel" className={fieldInput} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" /></DialogField>
      </div>
      <p className="text-[11px] text-muted-foreground">Hace falta el nombre y al menos un email o un teléfono. Si ya existía, uso ese contacto.</p>
      {notice && <p role="status" className="text-xs">{notice}</p>}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={submit} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Crear y usar
        </button>
        <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-border px-3 text-xs hover:bg-accent">Cancelar</button>
      </div>
    </div>
  );
}

/** El aviso de venta duplicada del paso 2 necesita el link a la venta existente. */
export function DuplicateSaleWarning({ sales, confirmed, onConfirm }: { sales: Array<{ id: string; status: string }>; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  if (sales.length === 0) return null;
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
      <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
        <span>Este contacto ya tiene una venta activa de este producto: {sales.map((s, i) => (
          <span key={s.id}>{i > 0 && ", "}<Link href={`/dashboard/ventas/${s.id}`} target="_blank" className="font-medium underline-offset-2 hover:underline">ver venta ({saleStatusLabel(s.status)})</Link></span>
        ))}.</span>
      </p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} /> Es otra venta, quiero cargarla igual</label>
    </div>
  );
}
