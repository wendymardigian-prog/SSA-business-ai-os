/**
 * Lo que pinta la bandeja de un grupo: la lista de grupos y el hilo, ya armado. PURO.
 *
 * El nombre de quien escribe sale, en este orden, del contacto vinculado (si la persona lo puede ver), del nombre
 * que mostro WhatsApp en ese mensaje, del que se guardo del miembro, o del telefono.
 */

import { parseAttachments, type ChatAttachment } from "@/lib/messages/attachments";

export interface GroupListRow {
  id: string;
  /** La cuenta de WhatsApp: la fila la nombra solo si hay mas de una. */
  channelId: string;
  subject: string;
  channelLabel: string;
  lastMessageAt: string | null;
  preview: string | null;
  unread: number;
  /** 00344: 'group' o 'announce' (el de Avisos de una comunidad). */
  kind: string;
  /** El nombre de la comunidad, si el grupo es de una. */
  communitySubject: string | null;
}

/** El grupo abierto: lo que necesita su panel, ademas del hilo. */
export interface SelectedGroup {
  id: string;
  subject: string;
  channelLabel: string;
  canWrite: boolean;
  /** 00344: 'group' o 'announce'. */
  kind: string;
  communitySubject: string | null;
  description: string | null;
  /** Cuantos miembros tiene segun WhatsApp (los guardados pueden ser menos). null si no se sabe. */
  size: number | null;
  /** Si el numero no puede escribir (solo admins envian y no es admin), el motivo. */
  writeBlockedReason: string | null;
  /** Lo que se puede cambiar del grupo desde la bandeja (`channels.manage`). */
  manage: {
    announce: boolean;
    restrict: boolean;
    numberIsAdmin: boolean | null;
  } | null;
  members: Array<{ key: string; label: string; contactId: string | null }>;
}

/** Quien voto una opcion: su nombre y, si la persona que mira lo puede ver, su contacto (para el link a la ficha). */
export interface ThreadPollVoter {
  name: string;
  contactId: string | null;
}

export interface ThreadPollOption {
  name: string;
  count: number;
  /** En orden alfabetico; «Vos» (el negocio) va primero. */
  voters: ThreadPollVoter[];
}

export interface ThreadMessage {
  id: string;
  outbound: boolean;
  senderLabel: string | null;
  contactId: string | null;
  text: string | null;
  attachments: ChatAttachment[];
  poll: { name: string; multiple: boolean; options: ThreadPollOption[]; totalVoters: number } | null;
  reactions: Array<{ emoji: string; count: number }>;
  failed: boolean;
  sendError: string | null;
  fromFlow: boolean;
  createdAt: string;
}

export interface ThreadInput {
  messages: Array<{
    id: string;
    direction: string;
    sender_participant_id: string | null;
    sender_name: string | null;
    text: string | null;
    attachments: unknown;
    poll: unknown;
    origin: string;
    status: string;
    send_error: string | null;
    created_at: string;
  }>;
  reactions: Array<{ message_id: string; participant_id: string; emoji: string; removed_at: string | null }>;
  votes: Array<{ message_id: string; participant_id: string; selected_options: string[] }>;
  members: Array<{ participant_id: string; display_name: string | null; phone: string | null }>;
  /** participant_id → el contacto vinculado (de `contact_channels`), si la persona lo ve. */
  contacts: Record<string, { id: string; name: string | null }>;
}

const BUSINESS = "me";

export function participantLabel(input: Pick<ThreadInput, "members" | "contacts">, participantId: string | null, pushName?: string | null): string | null {
  if (!participantId) return null;
  if (participantId === BUSINESS) return "Vos";
  const contact = input.contacts[participantId];
  if (contact?.name?.trim()) return contact.name.trim();
  if (pushName?.trim()) return pushName.trim();
  const member = input.members.find((m) => m.participant_id === participantId);
  if (member?.display_name?.trim()) return member.display_name.trim();
  if (member?.phone) return member.phone;
  return participantId.startsWith("+") ? participantId : "Alguien del grupo";
}

function readPoll(raw: unknown): { name: string; options: string[]; selectableCount: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as { name?: unknown; options?: unknown; selectableCount?: unknown };
  if (typeof p.name !== "string") return null;
  return {
    name: p.name,
    options: Array.isArray(p.options) ? p.options.filter((o): o is string => typeof o === "string") : [],
    selectableCount: typeof p.selectableCount === "number" ? p.selectableCount : 1,
  };
}

export function buildThread(input: ThreadInput): ThreadMessage[] {
  const ordered = [...input.messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return ordered.map((m) => {
    const poll = readPoll(m.poll);
    const votes = input.votes.filter((v) => v.message_id === m.id && v.selected_options.length > 0);
    const reactionCounts = new Map<string, number>();
    for (const r of input.reactions) {
      if (r.message_id !== m.id || r.removed_at) continue;
      reactionCounts.set(r.emoji, (reactionCounts.get(r.emoji) ?? 0) + 1);
    }
    return {
      id: m.id,
      outbound: m.direction === "outbound",
      senderLabel: m.direction === "outbound" ? null : participantLabel(input, m.sender_participant_id, m.sender_name),
      contactId: m.sender_participant_id ? (input.contacts[m.sender_participant_id]?.id ?? null) : null,
      text: m.text,
      attachments: parseAttachments(m.attachments),
      poll: poll
        ? {
            name: poll.name,
            multiple: poll.selectableCount !== 1,
            totalVoters: votes.length,
            // Las opciones de la encuesta, en su orden; un voto a una opcion que no figura (renombrada) se suma al final.
            options: Array.from(new Set([...poll.options, ...votes.flatMap((v) => v.selected_options)])).map((name) => {
              const voters = votes
                .filter((v) => v.selected_options.includes(name))
                .map((v) => ({ name: participantLabel(input, v.participant_id) ?? "Alguien", contactId: input.contacts[v.participant_id]?.id ?? null }))
                .sort((a, b) => (a.name === "Vos" ? -1 : b.name === "Vos" ? 1 : a.name.localeCompare(b.name, "es")));
              return { name, count: voters.length, voters };
            }),
          }
        : null,
      reactions: [...reactionCounts.entries()].map(([emoji, count]) => ({ emoji, count })),
      failed: m.status === "failed",
      sendError: m.send_error,
      fromFlow: m.origin === "flow",
      createdAt: m.created_at,
    };
  });
}
