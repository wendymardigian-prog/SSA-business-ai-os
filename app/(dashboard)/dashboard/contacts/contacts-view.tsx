"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, Users, X, Plus, Upload, Loader2, ChevronLeft, ChevronRight, Tag } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DoNotContactBadge,
  TagChip,
  TemperatureBadge,
  formatRelative,
  ActionError,
} from "@/components/contacts/ui";
import { LEAD_TEMPERATURES, LEAD_TEMPERATURE_LABELS } from "@/lib/contacts/fields";
import { bulkAddTag, createContact } from "@/lib/actions/contacts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BULK_TAG_LIMIT, describeEffect, hasEffect, sortEffectFirst } from "@/lib/tags/effects";
import type { LeadTemperature } from "@/lib/types/database";

/**
 * Lista de contactos.
 *
 * Los filtros no filtran nada en el cliente: escriben la URL y el Server
 * Component vuelve a consultar. Asi la paginacion es real y una vista filtrada
 * se puede compartir por link.
 */

export interface ContactRow {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  lastInteractionAt: string | null;
  temperature: LeadTemperature | null;
  doNotContact: boolean;
  setterId: string | null;
  vendedorId: string | null;
  tags: { id: string; name: string; color: string | null }[];
}

interface Filters {
  search: string;
  tagId: string;
  setterId: string;
  vendedorId: string;
  temperature: string;
  platform: string;
  /** "" oculta los anonimos, "1" los suma, "solo" muestra unicamente esos. */
  anon: string;
}

export function ContactsView({
  contacts,
  total,
  page,
  pageSize,
  tags,
  platforms,
  members,
  filters,
  anonymousCount,
}: {
  contacts: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: { id: string; name: string; color: string | null; disablesAgent?: boolean; assignsTo?: string | null }[];
  platforms: { value: string; label: string }[];
  members: { userId: string; label: string }[];
  filters: Filters;
  /** Cuantos contactos hay sin datos, esten o no en la lista. */
  anonymousCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [creating, setCreating] = useState(false);

  const memberLabel = new Map(members.map((m) => [m.userId, m.label]));

  // Seleccion para la accion masiva (Bloque 2d-A). Vale para la pagina que se
  // esta mirando: lo que ya no esta en pantalla no cuenta.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // El resultado de la ultima accion masiva: la barra se cierra al terminar.
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const pageIds = contacts.map((c) => c.id);
  const selected = pageIds.filter((id) => picked.has(id));
  const allOnPage = selected.length > 0 && selected.length === pageIds.length;
  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setPicked(allOnPage ? new Set() : new Set(pageIds));
  }
  const activeCount = Object.entries(filters).filter(([, v]) => v).length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  /** Escribe un parametro en la URL. Cualquier cambio de filtro vuelve a la pagina 1. */
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  function clearAll() {
    setSearchDraft("");
    start(() => router.replace(pathname));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Contactos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total} {total === 1 ? "contacto" : "contactos"}
              {activeCount > 0 && " con los filtros aplicados"}
              {/* Que la lista pase de 171 a 72 sin decir por que parece que se
                  perdieron contactos. */}
              {!filters.anon && anonymousCount > 0 && (
                <span className="text-muted-foreground/70">
                  {" · "}
                  {anonymousCount} sin datos {anonymousCount === 1 ? "oculto" : "ocultos"}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/contacts/import"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Upload className="h-4 w-4" />
              Importar CSV
            </Link>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Nuevo contacto
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setParam("q", searchDraft);
            }}
            className="relative min-w-[240px] flex-1 sm:max-w-sm"
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Nombre, email, teléfono o usuario…"
              aria-label="Buscar contactos"
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </form>

          <FilterSelect
            label="Tag"
            value={filters.tagId}
            onChange={(v) => setParam("tag", v)}
            options={tags.map((t) => ({ value: t.id, label: t.name }))}
          />
          <FilterSelect
            label="Setter"
            value={filters.setterId}
            onChange={(v) => setParam("setter", v)}
            options={members.map((m) => ({ value: m.userId, label: m.label }))}
          />
          <FilterSelect
            label="Vendedor"
            value={filters.vendedorId}
            onChange={(v) => setParam("vendedor", v)}
            options={members.map((m) => ({ value: m.userId, label: m.label }))}
          />
          <FilterSelect
            label="Temperatura"
            value={filters.temperature}
            onChange={(v) => setParam("temp", v)}
            options={LEAD_TEMPERATURES.map((t) => ({
              value: t,
              label: LEAD_TEMPERATURE_LABELS[t],
            }))}
          />
          {platforms.length > 0 && (
            <FilterSelect
              label="Canal"
              value={filters.platform}
              onChange={(v) => setParam("canal", v)}
              options={platforms}
            />
          )}

          {/* Los contactos sin datos se ocultan por defecto, asi que este
              selector no arranca vacio como los otros: su opcion neutra ya es
              una decision. */}
          {anonymousCount > 0 && (
            <select
              value={filters.anon}
              onChange={(e) => setParam("anon", e.target.value)}
              aria-label="Contactos sin datos"
              className={cn(
                "rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                filters.anon ? "border-primary" : "border-input",
              )}
            >
              <option value="">Sin datos: ocultos</option>
              <option value="1">Sin datos: incluidos</option>
              <option value="solo">Sin datos: solo esos</option>
            </select>
          )}

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar {activeCount} {activeCount === 1 ? "filtro" : "filtros"}
            </button>
          )}

          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {bulkNotice && (
        <div role="status" className="flex items-center justify-between gap-2 border-b border-border bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 md:px-8">
          <span>{bulkNotice}</span>
          <button type="button" onClick={() => setBulkNotice(null)} aria-label="Cerrar el aviso" className="rounded p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900/40">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {contacts.length === 0 ? (
          <EmptyState filtered={activeCount > 0} onClear={clearAll} onCreate={() => setCreating(true)} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="w-10 py-3 pl-4 pr-0">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && !allOnPage;
                    }}
                    onChange={togglePage}
                    aria-label="Seleccionar todos los contactos de esta página"
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Nombre</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Contacto</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Setter</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Vendedor</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Tags</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Última</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className={cn("border-b border-border transition-colors hover:bg-accent/40", picked.has(contact.id) && "bg-primary/5")}
                >
                  <td className="w-10 py-3 pl-4 pr-0">
                    <input
                      type="checkbox"
                      checked={picked.has(contact.id)}
                      onChange={() => togglePick(contact.id)}
                      aria-label={`Seleccionar a ${contact.displayName ?? "este contacto"}`}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/contacts/${contact.id}`} className="block">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {contact.displayName ?? "Sin nombre"}
                        </span>
                        <TemperatureBadge value={contact.temperature} />
                        {contact.doNotContact && <DoNotContactBadge />}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/contacts/${contact.id}`} className="block text-sm">
                      <span className="block text-muted-foreground">{contact.email ?? "—"}</span>
                      {contact.phone && (
                        <span className="block text-xs text-muted-foreground/70">{contact.phone}</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {contact.setterId ? (memberLabel.get(contact.setterId) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {contact.vendedorId ? (memberLabel.get(contact.vendedorId) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {contact.tags.map((tag) => (
                        <TagChip key={tag.id} name={tag.name} color={tag.color} />
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatRelative(contact.lastInteractionAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {lastPage > 1 && (
        <div className="flex items-center justify-between border-t border-border px-8 py-3">
          <p className="text-xs text-muted-foreground">
            Página {page} de {lastPage}
          </p>
          <div className="flex gap-2">
            <PageButton
              disabled={page <= 1}
              onClick={() => setParam("page", String(page - 1))}
              label="Anterior"
              icon={<ChevronLeft className="h-3.5 w-3.5" />}
            />
            <PageButton
              disabled={page >= lastPage}
              onClick={() => setParam("page", String(page + 1))}
              label="Siguiente"
              icon={<ChevronRight className="h-3.5 w-3.5" />}
              iconRight
            />
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <BulkTagBar
          contactIds={selected}
          tags={tags}
          memberLabel={memberLabel}
          onCancel={() => setPicked(new Set())}
          onDone={(text) => {
            setPicked(new Set());
            setBulkNotice(text);
            router.refresh();
          }}
        />
      )}

      {creating && <NewContactDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  if (options.length === 0) return null;
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-lg border bg-background px-3 py-2 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring",
        value ? "border-primary text-foreground" : "border-input text-muted-foreground",
      )}
    >
      <option value="">{label}: todos</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function PageButton({
  disabled,
  onClick,
  label,
  icon,
  iconRight,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  iconRight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-lg border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {!iconRight && icon}
      {label}
      {iconRight && icon}
    </button>
  );
}

/**
 * Dos estados vacios distintos: "todavia no hay nada" pide conectar un canal,
 * "el filtro no encontro nada" pide limpiar el filtro. Mostrar el primero
 * cuando en realidad hay contactos hace pensar que se perdieron los datos.
 */
function EmptyState({
  filtered,
  onClear,
  onCreate,
}: {
  filtered: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Users className="h-10 w-10 text-muted-foreground/40" />
      {filtered ? (
        <>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Ningún contacto coincide con estos filtros
          </p>
          <button
            onClick={onClear}
            className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Limpiar filtros
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Todavía no hay contactos
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground/70">
            Se crean solos cuando alguien escribe por un canal conectado. También
            los podés cargar a mano.
          </p>
          <button
            onClick={onCreate}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nuevo contacto
          </button>
        </>
      )}
    </div>
  );
}

/** Alta manual. Los mismos campos minimos que pide la deduplicacion: nombre, email o telefono. */
function NewContactDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState({ display_name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await createContact(values);
      if (!result.ok) {
        setError(result.error);
        setDuplicateId(result.duplicate ? (result.contactId ?? null) : null);
        return;
      }
      router.push(`/dashboard/contacts/${result.contactId}`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">Nuevo contacto</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Con el teléfono o el email alcanza para que no se duplique más adelante.
        </p>

        <div className="mt-4 space-y-3">
          {(
            [
              ["display_name", "Nombre", "text"],
              ["email", "Email", "email"],
              ["phone", "Teléfono", "tel"],
            ] as const
          ).map(([key, label, type]) => (
            <div key={key}>
              <label htmlFor={`new-${key}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                {label}
              </label>
              <input
                id={`new-${key}`}
                type={type}
                value={values[key]}
                onChange={(e) => {
                  setValues((prev) => ({ ...prev, [key]: e.target.value }));
                  setError(null);
                }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          ))}
        </div>

        <ActionError message={error} />

        {duplicateId && (
          <Link
            href={`/dashboard/contacts/${duplicateId}`}
            className="mt-2 inline-block text-sm font-medium underline underline-offset-2"
          >
            Ir a la ficha del contacto que ya existe
          </Link>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * La barra de la accion masiva (Bloque 2d-A): etiquetar los contactos
 * seleccionados. Wendy va a marcar varias decenas de conocidos de una
 * sentada. Una etiqueta con efecto pide confirmacion con las consecuencias.
 */
function BulkTagBar({
  contactIds,
  tags,
  memberLabel,
  onCancel,
  onDone,
}: {
  contactIds: string[];
  tags: { id: string; name: string; color: string | null; disablesAgent?: boolean; assignsTo?: string | null }[];
  memberLabel: Map<string, string>;
  onCancel: () => void;
  onDone: (summary: string) => void;
}) {
  const [tagId, setTagId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const options = sortEffectFirst(tags.map((t) => ({ ...t, disablesAgent: t.disablesAgent ?? false, assignsTo: t.assignsTo ?? null })));
  const chosen = options.find((t) => t.id === tagId) ?? null;
  const effect = chosen ? describeEffect(chosen, chosen.assignsTo ? (memberLabel.get(chosen.assignsTo) ?? null) : null) : null;
  const tooMany = contactIds.length > BULK_TAG_LIMIT;

  function apply() {
    if (!chosen) return;
    setMessage(null);
    start(async () => {
      const result = await bulkAddTag(contactIds, chosen.id);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      const parts = [`${result.tagged} ${result.tagged === 1 ? "contacto etiquetado" : "contactos etiquetados"}`];
      if (result.alreadyHad) parts.push(`${result.alreadyHad} ya la tenían`);
      if (result.notAllowed) parts.push(`${result.notAllowed} fuera de tu alcance`);
      onDone(`«${chosen.name}»: ${parts.join(" · ")}`);
    });
  }

  return (
    <div className="sticky bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {contactIds.length} {contactIds.length === 1 ? "seleccionado" : "seleccionados"}
        </span>
        <select
          value={tagId}
          onChange={(e) => {
            setTagId(e.target.value);
            setMessage(null);
          }}
          aria-label="Etiqueta para los seleccionados"
          className="min-h-11 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring md:min-h-0"
        >
          <option value="">Elegí una etiqueta…</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {hasEffect(t) ? `${t.name} (apaga el agente)` : t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => (chosen && hasEffect(chosen) ? setConfirming(true) : apply())}
          disabled={!chosen || pending || tooMany}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 md:min-h-0"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
          Etiquetar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent md:min-h-0"
        >
          Cancelar
        </button>
      </div>
      {effect && <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">«{chosen?.name}»: {effect}.</p>}
      {tooMany && <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">Hasta {BULK_TAG_LIMIT} contactos por vez.</p>}
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn("mt-1.5 text-xs", message.tone === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}
        >
          {message.text}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={`¿Marcar ${contactIds.length} ${contactIds.length === 1 ? "contacto" : "contactos"} como «${chosen?.name ?? ""}»?`}
        message={`${effect ?? ""}. Los que ya la tenían no se tocan.`}
        confirmLabel="Etiquetar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          setConfirming(false);
          apply();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
