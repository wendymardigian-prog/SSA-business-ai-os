"use client";

import { useState, useEffect, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { X, Mail, Phone, Brain, Loader2, ShieldOff, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AssignmentFields } from "@/components/contacts/assignment-fields";
import { FollowupField } from "@/components/contacts/followup-field";
import { NotesSection } from "@/components/contacts/notes-section";
import { TagsEditor, type TagOption } from "@/components/contacts/tags-editor";
import { TemperatureBadge, ActionError } from "@/components/contacts/ui";
import { setDoNotContact, updateContact } from "@/lib/actions/contacts";
import { LEAD_TEMPERATURES, LEAD_TEMPERATURE_LABELS } from "@/lib/contacts/fields";
import { readAttribution } from "@/lib/contacts/attribution";
import { platformLabel } from "@/lib/platforms";
import type { Database, LeadTemperature, Platform } from "@/lib/types/database";

/**
 * El panel del contacto en la bandeja (Bloque 2c, §8).
 *
 * Es el panel que se mira mientras se decide si una respuesta del agente se
 * aprueba. El orden va de lo que mas decide a lo que menos:
 *
 *   1. Identidad, con la temperatura como pill.
 *   2. Estado del lead: temperatura, proximo seguimiento, setter y vendedor.
 *   3. Memoria del agente: lo unico que pone al dia sobre un contacto en cinco
 *      segundos. Con cientos de conversaciones abiertas, leer el hilo entero
 *      antes de aprobar no es viable.
 *   4. Etiquetas.  5. Notas.  6. Todos los canales.  7. Actividad.
 *   8. No contactar, al final y separado: pausa las secuencias del contacto y
 *      no puede estar a un clic de cambiar una etiqueta.
 *
 * Todo lo editable escribe por las Server Actions del CRM con el cliente del
 * usuario (RLS = scope de leads) y queda en audit_log con quien lo cambio. Los
 * datos se cargan en el navegador; despues de cada cambio se recargan.
 */

type Contact = Database["public"]["Tables"]["contacts"]["Row"];

interface ContactDetails {
  contact: Contact;
  tagIds: string[];
  channels: { platform: Platform; username: string | null; senderId: string | null }[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  return new Date(dateStr).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PanelSection({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border p-4">
      <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

export function ContactPanel({
  contactId,
  workspaceId,
  onClose,
  members = [],
  allTags = [],
  currentUserId = "",
  isAdmin = false,
}: {
  contactId: string | null;
  workspaceId: string;
  onClose: () => void;
  members?: { userId: string; label: string }[];
  allTags?: TagOption[];
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const [loadedDetails, setDetails] = useState<ContactDetails | null>(null);
  const [loading, setLoading] = useState(false);
  // Cargar y no encontrar no son lo mismo que fallar. Sin esto, un error de
  // red o una sesion que todavia no termino de levantar se le mostraban a la
  // persona como "este contacto no existe", que es mentira y ademas asusta.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reload = () => setAttempt((n) => n + 1);

  useEffect(() => {
    if (!contactId) return;

    async function loadContact() {
      // Solo la primera carga muestra el spinner: recargar despues de guardar
      // no tiene que hacer parpadear todo el panel.
      if (!loadedDetails || loadedDetails.contact.id !== contactId) setLoading(true);
      setFailed(false);
      const supabase = createClient();

      // Esperar a que la sesion termine de levantarse desde las cookies. Sin
      // esto, abrir la bandeja con ?c= en la URL monta el panel en el primer
      // render, las consultas salen como anonimo, la RLS las corta y el panel
      // dice que el contacto no existe.
      await supabase.auth.getSession();

      const [contactRes, tagsRes, channelsRes] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", contactId!).single(),
        supabase.from("contact_tags").select("tag_id").eq("contact_id", contactId!),
        supabase.from("contact_channels").select("platform_username, platform_sender_id, channels(platform)").eq("contact_id", contactId!),
      ]);

      if (contactRes.error && !contactRes.data) {
        console.error("[inbox] no pude cargar el contacto:", contactRes.error.message);
        setFailed(true);
        setDetails(null);
      }

      if (contactRes.data) {
        setDetails({
          contact: contactRes.data,
          tagIds: (tagsRes.data ?? []).map((t) => t.tag_id),
          channels: (channelsRes.data ?? []).map((cc) => ({
            platform: (cc.channels as unknown as { platform: Platform }).platform,
            username: cc.platform_username,
            senderId: cc.platform_sender_id,
          })),
        });
      }

      setLoading(false);
    }

    loadContact();
    // loadedDetails no va en las dependencias: solo decide si mostrar el spinner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, workspaceId, attempt]);

  if (!contactId) return null;

  const details = loadedDetails?.contact.id === contactId ? loadedDetails : null;

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-background md:w-80">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h3 className="text-sm font-semibold">Datos del contacto</h3>
        <div className="flex items-center gap-1">
          {details && (
            <Link
              href={`/dashboard/contacts/${details.contact.id}`}
              title="Abrir la ficha completa"
              aria-label="Abrir la ficha completa"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
          <button
            onClick={onClose}
            aria-label="Cerrar el panel"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : details ? (
        <div className="flex-1 overflow-y-auto">
          <Identity details={details} />

          <PanelSection title="Estado del lead">
            <TemperatureSelect contactId={details.contact.id} value={details.contact.lead_temperature} onSaved={reload} />
            <FollowupField contactId={details.contact.id} value={details.contact.next_followup_date} onSaved={reload} />
            <AssignmentFields
              contactId={details.contact.id}
              members={members}
              setterId={details.contact.setter_id}
              vendedorId={details.contact.vendedor_id}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onSaved={reload}
            />
          </PanelSection>

          <AgentMemory contact={details.contact} />

          <PanelSection title="Etiquetas">
            <TagsEditor contactId={details.contact.id} allTags={allTags} assignedIds={details.tagIds} onSaved={reload} />
          </PanelSection>

          <div className="border-b border-border p-4 [&>section]:space-y-2">
            <NotesSection key={details.contact.id} contactId={details.contact.id} notes={details.contact.notes} onSaved={reload} />
          </div>

          <Channels details={details} />

          <Activity contact={details.contact} />

          <DoNotContact contact={details.contact} isAdmin={isAdmin} onSaved={reload} />
        </div>
      ) : failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-sm text-muted-foreground">No pude cargar los datos del contacto.</p>
          <button onClick={reload} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">
            Reintentar
          </button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No encontré ese contacto</div>
      )}
    </div>
  );
}

function Identity({ details }: { details: ContactDetails }) {
  const c = details.contact;
  const username = details.channels.find((ch) => ch.username)?.username ?? c.instagram_username;
  return (
    <div className="flex flex-col items-center border-b border-border p-5">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-semibold">
        {c.avatar_url ? (
          <img src={c.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          c.display_name?.[0]?.toUpperCase() ?? "?"
        )}
      </div>
      <p className="mt-3 text-sm font-semibold">{c.display_name ?? "Sin nombre"}</p>
      {username && <p className="mt-0.5 text-xs text-muted-foreground">@{username}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        <TemperatureBadge value={c.lead_temperature} />
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
            c.is_subscribed ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground",
          )}
        >
          {c.is_subscribed ? "Suscripto" : "Dado de baja"}
        </span>
        {c.do_not_contact && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">
            No contactar
          </span>
        )}
      </div>
    </div>
  );
}

function TemperatureSelect({ contactId, value, onSaved }: { contactId: string; value: LeadTemperature | null; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <label htmlFor="panel-temperature" className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        Temperatura
        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      </label>
      <select
        id="panel-temperature"
        value={value ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const result = await updateContact(contactId, { lead_temperature: e.target.value });
            if (!result.ok) return setError(result.error);
            setError(null);
            onSaved();
          })
        }
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        <option value="">Sin definir</option>
        {LEAD_TEMPERATURES.map((t) => (
          <option key={t} value={t}>
            {LEAD_TEMPERATURE_LABELS[t]}
          </option>
        ))}
      </select>
      <ActionError message={error} />
    </div>
  );
}

function AgentMemory({ contact }: { contact: Contact }) {
  const summary = contact.ai_conversation_summary?.trim();
  return (
    <PanelSection title="Memoria del agente" icon={<Brain className="h-3 w-3" />}>
      {summary ? (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{summary}</p>
          <p className="text-[11px] text-muted-foreground">
            {contact.ai_summary_updated_at
              ? `Actualizada el ${formatDate(contact.ai_summary_updated_at)}`
              : "Fecha de actualización no registrada (es anterior al modo borrador)."}{" "}
            La escribe el agente; se revierte desde Agentes → Acciones.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Todavía no hay memoria. El agente la genera cuando se cierra una conversación en la que participó, y la va sumando conversación a conversación.
        </p>
      )}
    </PanelSection>
  );
}

function Channels({ details }: { details: ContactDetails }) {
  const c = details.contact;
  type Extra = { icon: ReactNode; label: string; value: string };
  const extras: Extra[] = ([
    c.phone ? { icon: <Phone className="h-3.5 w-3.5" />, label: "Teléfono", value: c.phone } : null,
    c.whatsapp_phone && c.whatsapp_phone !== c.phone ? { icon: <Phone className="h-3.5 w-3.5" />, label: "WhatsApp", value: c.whatsapp_phone } : null,
    c.email ? { icon: <Mail className="h-3.5 w-3.5" />, label: "Email", value: c.email } : null,
  ] as Array<Extra | null>).filter((x): x is Extra => x !== null);

  return (
    <PanelSection title="Canales">
      {details.channels.length === 0 && extras.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin canales vinculados.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {details.channels.map((ch, i) => (
            <li key={i} className="flex items-center gap-2">
              <PlatformIcon platform={ch.platform} className="h-3.5 w-3.5" size={14} />
              <span className="text-muted-foreground">{platformLabel(ch.platform)}</span>
              <span className="truncate">
                {ch.username ? `@${ch.username}` : ch.platform === "whatsapp" && ch.senderId ? ch.senderId : ""}
              </span>
            </li>
          ))}
          {extras.map((x) => (
            <li key={x.label} className="flex items-center gap-2">
              <span className="text-muted-foreground">{x.icon}</span>
              <span className="text-muted-foreground">{x.label}</span>
              <span className="truncate">{x.value}</span>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function Activity({ contact }: { contact: Contact }) {
  const attribution = readAttribution(contact.attribution);
  const source = attribution.first_click?.utm_source ?? attribution.last_click?.utm_source ?? null;
  const campaign = attribution.first_click?.utm_campaign ?? null;
  return (
    <PanelSection title="Actividad">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Última interacción</dt>
        <dd>{formatDate(contact.last_interaction_at)}</dd>
        <dt className="text-muted-foreground">Creado</dt>
        <dd>{formatDate(contact.created_at)}</dd>
        {source && (
          <>
            <dt className="text-muted-foreground">Origen</dt>
            <dd className="truncate">{campaign ? `${source} · ${campaign}` : source}</dd>
          </>
        )}
      </dl>
    </PanelSection>
  );
}

function DoNotContact({ contact, isAdmin, onSaved }: { contact: Contact; isAdmin: boolean; onSaved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const marked = contact.do_not_contact;

  function apply(next: boolean) {
    setConfirming(false);
    start(async () => {
      const result = await setDoNotContact(contact.id, next);
      if (!result.ok) return setError(result.error);
      setError(null);
      onSaved();
    });
  }

  return (
    <section className="mt-6 space-y-2 border-t-4 border-double border-border p-4">
      <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-red-700 dark:text-red-400">
        <ShieldOff className="h-3 w-3" />
        No contactar
      </h4>
      {marked ? (
        <>
          <p className="text-xs text-muted-foreground">
            Marcado{contact.do_not_contact_reason ? ` (${contact.do_not_contact_reason})` : ""}
            {contact.do_not_contact_at ? ` el ${formatDate(contact.do_not_contact_at)}` : ""}. Sus secuencias están pausadas.
          </p>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending}
              className="rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Quitar la marca
            </button>
          ) : (
            <p className="text-[11px] text-muted-foreground">Solo Owner y Admin pueden quitar la marca.</p>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Pausa las secuencias activas del contacto y avisa antes de cada envío manual.</p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            Marcar como no contactar
          </button>
        </>
      )}
      <ActionError message={error} />
      <ConfirmDialog
        open={confirming}
        title={marked ? "¿Quitar la marca de no contactar?" : "¿Marcar como no contactar?"}
        message={
          marked
            ? "Las secuencias pausadas por la marca no se reanudan solas."
            : "Se pausan las secuencias activas de este contacto, y cada envío manual va a pedir confirmación."
        }
        confirmLabel={marked ? "Quitar la marca" : "Marcar"}
        destructive={!marked}
        onConfirm={() => apply(!marked)}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
