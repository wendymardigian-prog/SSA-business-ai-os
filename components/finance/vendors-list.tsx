"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Pencil, Plus, RotateCcw, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { FinanceTabs, ReadOnlyNote } from "@/components/finance/finance-tabs";
import { SaleModal } from "@/components/sales/sale-modal";
import { createVendor, setVendorArchived, updateVendor } from "@/lib/actions/finance-vendors";
import { expensesHref } from "@/lib/finance/expense-filters";
import { formatUsd } from "@/lib/finance/format";
import { VENDOR_NOTES_MAX, VENDOR_PAYMENT_DETAILS_MAX, VENDOR_TERMS_MAX } from "@/lib/finance/vendors";
import {
  EMPTY_VENDOR_DRAFT, countVendors, countryName, countryOptions, draftFromVendor, filterVendors, toVendorInput, vendorDraftError,
  type VendorDraft, type VendorRow, type VendorTotals, type VendorView,
} from "@/lib/finance/vendor-totals";
import { formatCivilDate } from "@/lib/finance/view";

/**
 * Finanzas > Proveedores. Un proveedor no se borra: se archiva (los gastos viejos lo siguen mostrando y deja de
 * ofrecerse en los nuevos). Un proveedor que es una persona del equipo no se renombra a mano. Los datos de pago
 * los ve quien tiene acceso a Finanzas; no salen en el CSV.
 */
export type VendorListItem = VendorRow & VendorTotals;

export function VendorsList({
  vendors, templatesByVendor, canManage, loadError, totalsFailed, totalsTruncated,
}: {
  vendors: VendorListItem[];
  /** Conceptos de las plantillas activas que usan cada proveedor. */
  templatesByVendor: Record<string, string[]>;
  canManage: boolean;
  loadError: boolean;
  totalsFailed: boolean;
  totalsTruncated: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<VendorView>("activos");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<VendorDraft | null>(null);
  const [formError, setFormError] = useState<{ message: string; existing?: { id: string; name: string } } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<VendorListItem | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const counts = useMemo(() => countVendors(vendors), [vendors]);
  const shown = useMemo(() => filterVendors(vendors, { view, q }), [vendors, view, q]);
  const editing = draft?.id ? vendors.find((v) => v.id === draft.id) : null;
  const isTeam = !!editing?.user_id;

  function openNew() {
    setFormError(null);
    setDraft({ ...EMPTY_VENDOR_DRAFT });
  }
  function openEdit(v: VendorListItem) {
    setFormError(null);
    setDraft(draftFromVendor(v));
  }

  function save() {
    if (!draft) return;
    const invalid = vendorDraftError(draft);
    if (invalid) return setFormError({ message: invalid });
    start(async () => {
      const input = toVendorInput(draft);
      const result = draft.id ? await updateVendor(draft.id, input) : await createVendor(input);
      if (!result.ok) {
        const existing = result.existingId ? vendors.find((v) => v.id === result.existingId) : undefined;
        return setFormError({ message: result.error, existing: existing ? { id: existing.id, name: existing.name } : undefined });
      }
      setDraft(null);
      setFormError(null);
      router.refresh();
    });
  }

  function archive(v: VendorListItem, archived: boolean) {
    setRowError(null);
    start(async () => {
      const result = await setVendorArchived(v.id, archived);
      setConfirmArchive(null);
      if (!result.ok) return setRowError(result.error);
      router.refresh();
    });
  }
  function askArchive(v: VendorListItem) {
    if ((templatesByVendor[v.id] ?? []).length > 0) return setConfirmArchive(v);
    archive(v, true);
  }

  const addButton = canManage ? (
    <button type="button" onClick={openNew} aria-label="Nuevo proveedor" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
      <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Proveedor</span>
    </button>
  ) : undefined;

  const templates = confirmArchive ? (templatesByVendor[confirmArchive.id] ?? []) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/finanzas/proveedores" tabs={<FinanceTabs />} right={addButton} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="space-y-4">
          {!canManage && <ReadOnlyNote />}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2" role="group" aria-label="Estado del proveedor">
              {(["activos", "archivados"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${view === v ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-accent"}`}
                >
                  {v === "activos" ? "Activos" : "Archivados"}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{counts[v]}</span>
                </button>
              ))}
            </div>
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs" role="search">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre" aria-label="Buscar proveedores por nombre" className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-sm" />
            </div>
            {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
          </div>

          {rowError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{rowError}</p>}
          {totalsFailed && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">No pudimos calcular lo pagado a cada proveedor. Recargá la página para volver a intentarlo.</p>}
          {totalsTruncated && <p className="text-[11px] text-muted-foreground">Hay muchísimos gastos pagados: los totales cuentan los primeros 20.000.</p>}

          {loadError ? (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
              <p className="text-red-700 dark:text-red-300">No pudimos cargar los proveedores.</p>
              <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
            </div>
          ) : vendors.length === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm">
              <p className="font-medium">Todavía no hay proveedores</p>
              <p className="mt-1 text-muted-foreground">Cargá a quién le pagás (agencias, software, contadora) para ver cuánto le pagaste en total y en el año.</p>
              {canManage && (
                <button type="button" onClick={openNew} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                  <Plus className="h-4 w-4" aria-hidden /> Proveedor
                </button>
              )}
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
              {q.trim() ? "Ningún proveedor coincide con la búsqueda." : view === "archivados" ? "No hay proveedores archivados." : "No hay proveedores activos."}
              {q.trim() && <button type="button" onClick={() => setQ("")} className="ml-2 underline">Limpiar</button>}
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                <table className="w-full min-w-[860px] text-sm">
                  <caption className="sr-only">Proveedores, con lo que se les pagó</caption>
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      {["Nombre", "País", "Email", "Pagado en total", "Pagado este año", "Último pago", ""].map((h, i) => (
                        <th key={i} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${i === 3 || i === 4 ? "text-right" : ""}`}>{h || <span className="sr-only">Acciones</span>}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shown.map((v) => (
                      <tr key={v.id} className="hover:bg-muted/30">
                        <td className="max-w-[240px] px-3 py-2"><NameCell v={v} /></td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{countryName(v.country)}</td>
                        <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground">{v.email ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatUsd(v.paidCents)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatUsd(v.paidYearCents)}</td>
                        <td className="whitespace-nowrap px-3 py-2">{formatCivilDate(v.lastPaid)}</td>
                        <td className="px-3 py-2"><RowActions v={v} canManage={canManage} onEdit={() => openEdit(v)} onArchive={() => askArchive(v)} onRestore={() => archive(v, false)} disabled={pending} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-2 md:hidden">
                {shown.map((v) => (
                  <li key={v.id} className="rounded-xl border border-border p-3">
                    <NameCell v={v} />
                    <p className="mt-0.5 text-xs text-muted-foreground">{[countryName(v.country) !== "—" ? countryName(v.country) : null, v.email].filter(Boolean).join(" · ") || "Sin más datos"}</p>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><dt className="text-muted-foreground">Total</dt><dd className="font-medium tabular-nums">{formatUsd(v.paidCents)}</dd></div>
                      <div><dt className="text-muted-foreground">Este año</dt><dd className="font-medium tabular-nums">{formatUsd(v.paidYearCents)}</dd></div>
                      <div><dt className="text-muted-foreground">Último pago</dt><dd className="font-medium">{formatCivilDate(v.lastPaid)}</dd></div>
                    </dl>
                    <div className="mt-2"><RowActions v={v} canManage={canManage} onEdit={() => openEdit(v)} onArchive={() => askArchive(v)} onRestore={() => archive(v, false)} disabled={pending} /></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {draft && (
        <SaleModal
          title={draft.id ? "Editar proveedor" : "Nuevo proveedor"}
          label={draft.id ? "Editar proveedor" : "Nuevo proveedor"}
          onClose={() => setDraft(null)}
          footer={
            <>
              {formError && (
                <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">
                  {formError.message}
                  {formError.existing && (
                    <button
                      type="button"
                      className="ml-2 underline"
                      onClick={() => {
                        setDraft(null);
                        setView("activos");
                        setQ(formError.existing!.name);
                      }}
                    >
                      Ver «{formError.existing.name}»
                    </button>
                  )}
                </p>
              )}
              <button type="button" onClick={() => setDraft(null)} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
              <button type="button" disabled={pending} onClick={save} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
              </button>
            </>
          }
        >
          <DialogField label="Nombre" hint={isTeam ? "Es una persona del equipo: su nombre sale de su perfil y no se edita acá." : undefined}>
            <input className={fieldInput} maxLength={120} value={draft.name} disabled={isTeam} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej.: Agencia de diseño" />
          </DialogField>
          <div className="grid gap-3 sm:grid-cols-2">
            <DialogField label="País (opcional)">
              <select className={fieldInput} value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })}>
                <option value="">Sin país</option>
                {countryOptions(draft.country || null).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </DialogField>
            <DialogField label="Email (opcional)">
              <input className={fieldInput} type="email" inputMode="email" maxLength={200} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="facturas@proveedor.com" />
            </DialogField>
          </div>
          <DialogField label="Datos de pago (opcional)" hint={`Cuenta, alias o link de pago. Lo ve quien tiene acceso a Finanzas y no sale en el CSV. ${draft.paymentDetails.length}/${VENDOR_PAYMENT_DETAILS_MAX}`}>
            <textarea className={`${fieldInput} min-h-20`} maxLength={VENDOR_PAYMENT_DETAILS_MAX} value={draft.paymentDetails} onChange={(e) => setDraft({ ...draft, paymentDetails: e.target.value })} />
          </DialogField>
          <DialogField label="Condiciones (opcional)">
            <input className={fieldInput} maxLength={VENDOR_TERMS_MAX} value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} placeholder="Ej.: paga a 30 días" />
          </DialogField>
          <DialogField label="Notas (opcional)" hint={`${draft.notes.length}/${VENDOR_NOTES_MAX}`}>
            <textarea className={`${fieldInput} min-h-20`} maxLength={VENDOR_NOTES_MAX} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </DialogField>
        </SaleModal>
      )}

      {confirmArchive && (
        <SaleModal
          title="Archivar proveedor"
          label="Archivar proveedor"
          onClose={() => setConfirmArchive(null)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmArchive(null)} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
              <button type="button" disabled={pending} onClick={() => archive(confirmArchive, true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Archivar igual
              </button>
            </>
          }
        >
          <p className="text-sm">
            <strong>{confirmArchive.name}</strong> lo {templates.length === 1 ? "usa la plantilla recurrente" : "usan las plantillas recurrentes"}{" "}
            {templates.map((t) => `«${t}»`).join(", ")}.
          </p>
          <p className="text-sm text-muted-foreground">Si lo archivás, {templates.length === 1 ? "esa plantilla sigue" : "esas plantillas siguen"} generando gastos con este proveedor hasta que se lo cambies. Los gastos que ya existen lo siguen mostrando.</p>
        </SaleModal>
      )}
    </div>
  );
}

function NameCell({ v }: { v: VendorListItem }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="min-w-0 truncate font-medium">{v.name}</span>
      {v.user_id && (
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
          <Users className="h-3 w-3" aria-hidden /> Persona del equipo
        </span>
      )}
      {v.archived_at && <span className="rounded-full bg-zinc-500/12 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">Archivado</span>}
    </span>
  );
}

function RowActions({ v, canManage, onEdit, onArchive, onRestore, disabled }: { v: VendorListItem; canManage: boolean; onEdit: () => void; onArchive: () => void; onRestore: () => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap">
      <Link href={expensesHref({ vendors: [v.id] })} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">Ver gastos</Link>
      {canManage && (
        <>
          <button type="button" onClick={onEdit} aria-label={`Editar ${v.name}`} className="rounded-md border border-border p-1.5 hover:bg-accent"><Pencil className="h-3.5 w-3.5" aria-hidden /></button>
          {v.archived_at ? (
            <button type="button" onClick={onRestore} disabled={disabled} aria-label={`Restaurar ${v.name}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restaurar</button>
          ) : (
            <button type="button" onClick={onArchive} disabled={disabled} aria-label={`Archivar ${v.name}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"><Archive className="h-3.5 w-3.5" aria-hidden /> Archivar</button>
          )}
        </>
      )}
    </div>
  );
}
