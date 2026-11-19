// @plantilla-quitar(servicios)
"use client";

import { serviceHref } from "@/lib/services/screens/record-url";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search } from "lucide-react";
import { checkSaleRule, contactSalesWithoutService, createContactForService, createService, searchContactsForService } from "@/lib/actions/services";
import { RULE_REASON_LABELS, defaultServiceStartsOn, newServiceFormIssues, serviceStartsOnHint, type NewServiceForm } from "@/lib/services/screens/service";
import { todayIn } from "@/lib/services/screens/today";
import { ActionError } from "@/components/contacts/ui";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { QuickCreateContact } from "@/components/contacts/quick-create-contact";
import { useContactSearchWith } from "@/components/shared/use-contact-search";

export interface NewServiceOptions {
  /** Productos con sus variantes que crean servicios. */
  products: Array<{ id: string; name: string; variants: Array<{ id: string; name: string; eventDate?: string | null }> }>;
  members: Array<{ id: string; name: string }>;
  canOffRule: boolean;
  /** Hoy (AAAA-MM-DD) en la zona del negocio: la fecha de inicio por defecto. */
  today?: string;
}

/**
 * «+ Servicio» (F30): origen (Venta · Cortesía · Prueba · Manual), venta (las del contacto sin servicio), contacto,
 * producto y variante, inicio, responsable y motivo (obligatorio sin venta). Si la venta no cumple la regla de su
 * variante, el modal se pone en rojo con el motivo y lo pide (F95). Crea con `createService`. Sin contacto
 * elegido, «Crear contacto» lo da de alta ahí mismo (el mismo alta rápida que el asistente de venta).
 */
export function NewServiceDialog({
  options,
  onClose,
  preset,
}: {
  options: NewServiceOptions;
  onClose: () => void;
  preset?: { contactId?: string; contactName?: string; saleId?: string; variantId?: string };
}) {
  const router = useRouter();
  const today = options.today ?? todayIn(null);
  const eventDateOf = (variantId: string) => options.products.flatMap((p) => p.variants).find((v) => v.id === variantId)?.eventDate ?? null;
  // La fecha propuesta sigue a la variante (un Evento empieza en su fecha) hasta que la persona la cambia a mano.
  const [startsTouched, setStartsTouched] = useState(false);
  const [form, setForm] = useState<NewServiceForm>({
    origin: preset?.saleId ? "sale" : "manual",
    saleId: preset?.saleId ?? "",
    contactId: preset?.contactId ?? "",
    variantId: preset?.variantId ?? "",
    startsOn: defaultServiceStartsOn(today, eventDateOf(preset?.variantId ?? "")),
    ownerId: "",
    reason: "",
  });
  const [contactName, setContactName] = useState(preset?.contactName ?? "");
  const [creatingContact, setCreatingContact] = useState(false);
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  const search = useContactSearchWith(async (q) => (await searchContactsForService(q)).map((c) => ({ id: c.id, name: c.name, email: c.email ?? c.phone })));
  const [sales, setSales] = useState<Array<{ id: string; label: string; variantId: string }>>([]);
  const [rule, setRule] = useState<{ met: boolean; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<NewServiceForm>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if (patch.variantId !== undefined && patch.variantId !== f.variantId && !startsTouched) next.startsOn = defaultServiceStartsOn(today, eventDateOf(next.variantId));
      return next;
    });

  useEffect(() => {
    if (!form.contactId) return;
    let alive = true;
    contactSalesWithoutService(form.contactId).then((r) => alive && setSales(r));
    return () => {
      alive = false;
    };
  }, [form.contactId]);

  useEffect(() => {
    if (form.origin !== "sale" || !form.saleId) return;
    let alive = true;
    checkSaleRule(form.saleId).then((r) => alive && setRule(r.ok ? { met: r.data.met, reason: r.data.reason } : null));
    return () => {
      alive = false;
    };
  }, [form.origin, form.saleId]);

  const offRule = form.origin === "sale" && rule !== null && !rule.met;
  const issues = [...newServiceFormIssues(form), ...(offRule && !form.reason.trim() ? ["La venta no cumple la regla: escribí el motivo."] : [])];

  function pickContact(c: { id: string; name: string }, notice: string | null = null) {
    set({ contactId: c.id, saleId: "" });
    setContactName(c.name);
    setContactNotice(notice);
    setCreatingContact(false);
    search.reset();
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await createService({
        contactId: form.contactId,
        variantId: form.variantId,
        saleId: form.origin === "sale" ? form.saleId : null,
        origin: form.origin,
        reason: form.reason.trim() || null,
        startsOn: form.startsOn || null,
        ownerUserId: form.ownerId || null,
        offRule,
      });
      if (!res.ok) return setError(res.error.message);
      router.push(serviceHref(res.data));
    });
  }

  return (
    <ContentDialog
      title="Nuevo servicio"
      label="Nuevo servicio"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending || issues.length > 0 || (offRule && !options.canOffRule)}
            onClick={submit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Crear
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <DialogField label="Origen">
          <select value={form.origin} onChange={(e) => set({ origin: e.target.value as NewServiceForm["origin"], saleId: "" })} className={fieldInput}>
            <option value="sale">Venta</option>
            <option value="courtesy">Cortesía</option>
            <option value="test">Prueba</option>
            <option value="manual">Manual</option>
          </select>
        </DialogField>
        {/* Un div y no DialogField (un <label>): adentro van el alta rápida, con sus propios campos, y botones. */}
        <div className="space-y-1">
          <span className="block text-xs font-medium">Contacto</span>
          {form.contactId ? (
            <>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="truncate">{contactName}</span>
                {!preset?.contactId && (
                  <button
                    type="button"
                    onClick={() => {
                      set({ contactId: "", saleId: "" });
                      setContactNotice(null);
                    }}
                    className="text-xs text-primary-ink hover:underline"
                  >
                    Cambiar
                  </button>
                )}
              </div>
              {contactNotice && (
                <p role="status" className="mt-1 text-xs text-muted-foreground">
                  {contactNotice}
                </p>
              )}
            </>
          ) : creatingContact ? (
            <QuickCreateContact create={createContactForService} onCancel={() => setCreatingContact(false)} onCreated={(c) => pickContact(c, c.notice)} />
          ) : (
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
                <ul className="max-h-40 overflow-auto rounded-lg border border-border" aria-label="Contactos encontrados">
                  {search.options.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => pickContact(c)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent">
                        {c.name} {c.email && <span className="text-xs text-muted-foreground">· {c.email}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {search.query.trim().length >= 2 && !search.searching && search.options.length === 0 && <p className="text-xs text-muted-foreground">No encontré a nadie con eso.</p>}
              <button type="button" onClick={() => setCreatingContact(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent">
                <Plus className="h-3.5 w-3.5" aria-hidden /> Crear contacto
              </button>
            </div>
          )}
        </div>
        {form.origin === "sale" && (
          <DialogField label="Venta" hint={form.contactId && sales.length === 0 ? "Este contacto no tiene ventas sin servicio." : undefined}>
            <select
              value={form.saleId}
              onChange={(e) => {
                const sale = sales.find((s) => s.id === e.target.value);
                set({ saleId: e.target.value, variantId: sale?.variantId ?? form.variantId });
              }}
              className={fieldInput}
              disabled={!form.contactId}
            >
              <option value="">Elegí…</option>
              {sales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </DialogField>
        )}
        <DialogField label="Producto y variante">
          <select value={form.variantId} onChange={(e) => set({ variantId: e.target.value })} className={fieldInput}>
            <option value="">Elegí…</option>
            {options.products.map((p) => (
              <optgroup key={p.id} label={p.name}>
                {p.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {p.name} · {v.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </DialogField>
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Fecha de inicio" hint={serviceStartsOnHint(eventDateOf(form.variantId))}>
            <input
              type="date"
              value={form.startsOn}
              onChange={(e) => {
                setStartsTouched(true);
                set({ startsOn: e.target.value });
              }}
              className={fieldInput}
            />
          </DialogField>
          <DialogField label="Responsable" hint="Vacío: el que da la variante.">
            <select value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })} className={fieldInput}>
              <option value="">Automático</option>
              {options.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </DialogField>
        </div>
        {offRule && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Esta venta no cumple la regla de su variante: {RULE_REASON_LABELS[rule!.reason] ?? rule!.reason} Para crearlo igual, escribí el motivo.
            {!options.canOffRule && " No tenés permiso para crear servicios fuera de la regla."}
          </p>
        )}
        {(form.origin !== "sale" || offRule) && (
          <DialogField label="Motivo">
            <textarea value={form.reason} onChange={(e) => set({ reason: e.target.value })} rows={2} className={fieldInput} />
          </DialogField>
        )}
        {issues.length > 0 && <p className="text-xs text-muted-foreground">{issues[0]}</p>}
        {error && <ActionError message={error} />}
      </div>
    </ContentDialog>
  );
}
