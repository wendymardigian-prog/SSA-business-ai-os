/**
 * Un Evolution (WhatsApp) de mentira, con estado en memoria, para las pruebas, los verify y las capturas.
 * Responde lo que usa la plataforma para mandar: la versión, el estado de la instancia, «¿tiene WhatsApp?», texto,
 * archivos, audios, stickers y encuestas. NUNCA sale a la red: cada envío queda anotado en `sent`.
 *
 * Escenarios por el número de destino (así un verify o una captura eligen el caso sin configurar nada):
 *   - termina en «4004» → WhatsApp lo rechaza (400 «el número no existe»): no se reintenta;
 *   - termina en «5003» → el servidor no responde bien (503): es un fallo de transporte y se reintenta;
 *   - termina en «0000» → «¿tiene WhatsApp?» dice que no;
 *   - cualquier otro    → sale bien.
 * Y por la instancia: si contiene «caida», el estado de la conexión es «close» (sesión caída).
 * Además, `failNext(destino, estado, veces)` hace fallar los próximos envíos a ese destino (para probar reintentos).
 *
 * Grupos: crear un grupo (`group/create`) y sumar o quitar personas (`group/updateParticipant`)
 * quedan en `groups`. Un teléfono que termina en «4030» no se deja agregar (403: hay que mandarle el link).
 */

export interface FakeEvolutionSend {
  at: string;
  instance: string;
  /** El número o el grupo, tal como lo pidió la plataforma. */
  to: string;
  kind: "text" | "media" | "audio" | "sticker" | "poll";
  text: string | null;
  id: string;
}

export interface FakeEvolutionGroup {
  instance: string;
  jid: string;
  subject: string;
  description: string | null;
  /** Los dígitos de cada persona que está en el grupo (sin el número que lo creó). */
  participants: string[];
  /** Los dígitos de los admins del grupo (el número que lo creó lo es siempre). */
  admins?: string[];
  /** true = solo los admins escriben. */
  announce?: boolean;
  /** true = solo los admins cambian nombre, foto y descripción. */
  restrict?: boolean;
  /** La comunidad madre (no tiene mensajes). */
  isCommunity?: boolean;
  /** El grupo de Avisos de una comunidad. */
  isCommunityAnnounce?: boolean;
  /** El JID de la comunidad a la que pertenece. */
  parentJid?: string | null;
  /** El número (dígitos) que maneja la instancia: lo marca admin en la lista de miembros. */
  ownerDigits?: string | null;
  invite?: number;
  left?: boolean;
}

interface FakeEvolutionState {
  sent: FakeEvolutionSend[];
  groups: Map<string, FakeEvolutionGroup>;
  /** Pedidos que no son de envío (estado, versión, «¿tiene WhatsApp?»). */
  other: Array<{ at: string; method: string; path: string }>;
  failures: Map<string, { status: number; times: number }>;
  seq: number;
}

const KEY = Symbol.for("ssa.fake-evolution.state");
type GlobalWithState = typeof globalThis & { [KEY]?: FakeEvolutionState };

/** El estado es uno por proceso (también si el módulo se carga dos veces, como en vite-node). */
export function fakeEvolutionState(): FakeEvolutionState {
  const g = globalThis as GlobalWithState;
  g[KEY] ??= { sent: [], groups: new Map(), other: [], failures: new Map(), seq: 0 };
  g[KEY]!.groups ??= new Map();
  return g[KEY]!;
}

/** Vacía lo anotado y los fallos programados. */
export function resetFakeEvolution(): void {
  const s = fakeEvolutionState();
  s.sent.length = 0;
  s.groups.clear();
  s.other.length = 0;
  s.failures.clear();
  s.seq = 0;
}

/**
 * Deja un grupo (o una comunidad) ya existente en el número simulado: así se prueban la lista de grupos, las
 * comunidades, los miembros y la configuración sin crear nada.
 */
export function seedFakeGroup(group: FakeEvolutionGroup): void {
  fakeEvolutionState().groups.set(group.jid, { ...group, participants: group.participants.map((p) => p.replace(/\D/g, "")) });
}

function groupRow(g: FakeEvolutionGroup, withParticipants: boolean): Record<string, unknown> {
  const admins = new Set((g.admins ?? []).map((a) => a.replace(/\D/g, "")));
  const people = [
    ...(g.ownerDigits ? [{ id: `${g.ownerDigits}@s.whatsapp.net`, phoneNumber: `${g.ownerDigits}@s.whatsapp.net`, admin: "superadmin" }] : []),
    ...g.participants.map((d) => ({ id: `${d}@s.whatsapp.net`, phoneNumber: `${d}@s.whatsapp.net`, admin: admins.has(d) ? "admin" : null })),
  ];
  return {
    id: g.jid,
    subject: g.subject,
    desc: g.description ?? "",
    size: people.length,
    announce: g.announce === true,
    restrict: g.restrict === true,
    isCommunity: g.isCommunity === true,
    isCommunityAnnounce: g.isCommunityAnnounce === true,
    ...(g.parentJid ? { linkedParent: g.parentJid } : {}),
    ...(withParticipants ? { participants: people } : {}),
  };
}

/** Los próximos `times` envíos a `to` (los dígitos, o el JID del grupo) responden `status`. */
export function failNext(to: string, status: number, times = 1): void {
  fakeEvolutionState().failures.set(digitsOrJid(to), { status, times });
}

function digitsOrJid(to: string): string {
  return to.includes("@g.us") ? to : to.replace(/\D/g, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SEND_KIND: Record<string, FakeEvolutionSend["kind"]> = {
  sendText: "text",
  sendMedia: "media",
  sendWhatsAppAudio: "audio",
  sendSticker: "sticker",
  sendPoll: "poll",
};

/** El `fetch` simulado. Solo entiende rutas de Evolution; cualquier otra cosa responde 404 sin salir. */
export const fakeEvolutionFetch: typeof fetch = async (input, init) => {
  const state = fakeEvolutionState();
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.pathname;
  const at = new Date().toISOString();
  let body: Record<string, unknown> = {};
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  if (path === "/" || path === "") {
    state.other.push({ at, method, path });
    return json({ version: "2.3.7" });
  }

  const [, group, action, rawInstance] = path.split("/");
  const instance = decodeURIComponent(rawInstance ?? "");

  if (group === "instance" && action === "connectionState") {
    state.other.push({ at, method, path });
    return json({ instance: { instanceName: instance, state: /caida/i.test(instance) ? "close" : "open" } });
  }

  if (group === "chat" && action === "whatsappNumbers") {
    state.other.push({ at, method, path });
    const numbers = Array.isArray(body.numbers) ? (body.numbers as unknown[]).map(String) : [];
    return json(numbers.map((n) => ({ number: n, exists: !n.replace(/\D/g, "").endsWith("0000"), jid: `${n.replace(/\D/g, "")}@s.whatsapp.net` })));
  }

  if (group === "settings" && action === "find") {
    state.other.push({ at, method, path });
    return json({ groupsIgnore: false, rejectCall: false, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false });
  }

  if (group === "group" && action === "create" && method === "POST") {
    state.seq += 1;
    const jid = `1203630${String(state.seq).padStart(11, "0")}@g.us`;
    const participants = Array.isArray(body.participants) ? (body.participants as unknown[]).map((p) => String(p).replace(/\D/g, "")) : [];
    state.groups.set(jid, {
      instance,
      jid,
      subject: String(body.subject ?? ""),
      description: typeof body.description === "string" ? body.description : null,
      participants: participants.filter((p) => !p.endsWith("4030")),
    });
    return json({ id: jid, subject: body.subject ?? "" }, 201);
  }

  // Administrar grupos desde el panel: listar, ver, miembros y configuración.
  if (group === "group" && action === "fetchAllGroups") {
    state.other.push({ at, method, path });
    const withParticipants = url.searchParams.get("getParticipants") === "true";
    return json([...state.groups.values()].filter((g) => g.instance === instance && !g.left).map((g) => groupRow(g, withParticipants)));
  }
  if (group === "group" && action) {
    const jid = url.searchParams.get("groupJid") ?? "";
    const g = state.groups.get(jid);
    const manage: Record<string, true> = {
      findGroupInfos: true, participants: true, updateGroupSubject: true, updateGroupDescription: true, updateGroupPicture: true,
      updateSetting: true, inviteCode: true, revokeInviteCode: true, leaveGroup: true,
    };
    if (manage[action]) {
      state.other.push({ at, method, path });
      if (!g || g.instance !== instance || g.left) return json({ status: 404, error: "Grupo no encontrado (simulado)" }, 404);
      if (action === "findGroupInfos") return json(groupRow(g, true));
      if (action === "participants") return json({ participants: (groupRow(g, true).participants as unknown[]) ?? [] });
      if (action === "updateGroupSubject") g.subject = String(body.subject ?? g.subject);
      if (action === "updateGroupDescription") g.description = typeof body.description === "string" ? body.description : g.description;
      if (action === "updateSetting") {
        const a = String(body.action ?? "");
        if (a === "announcement") g.announce = true;
        if (a === "not_announcement") g.announce = false;
        if (a === "locked") g.restrict = true;
        if (a === "unlocked") g.restrict = false;
      }
      if (action === "inviteCode" || action === "revokeInviteCode") {
        if (action === "revokeInviteCode") g.invite = (g.invite ?? 0) + 1;
        const code = `SIM${jid.slice(0, 8)}${g.invite ?? 0}`;
        return json({ inviteUrl: `https://chat.whatsapp.com/${code}`, inviteCode: code });
      }
      if (action === "leaveGroup") g.left = true;
      return json({ status: "ok" });
    }
  }

  if (group === "group" && action === "updateParticipant" && method === "POST") {
    const jid = url.searchParams.get("groupJid") ?? "";
    const saved = state.groups.get(jid);
    const list = Array.isArray(body.participants) ? (body.participants as unknown[]).map((p) => String(p).replace(/\D/g, "")) : [];
    const op = String(body.action ?? "");
    const rows = list.map((digits) => {
      if (op === "add" && digits.endsWith("4030")) return { jid: `${digits}@s.whatsapp.net`, status: "403" };
      if (saved && op === "add" && !saved.participants.includes(digits)) saved.participants.push(digits);
      if (saved && op === "remove") saved.participants = saved.participants.filter((p) => p !== digits);
      return { jid: `${digits}@s.whatsapp.net`, status: "200" };
    });
    return json({ updateParticipants: rows });
  }

  if (group === "message" && action && SEND_KIND[action]) {
    const to = String(body.number ?? "");
    const key = digitsOrJid(to);
    const planned = state.failures.get(key);
    if (planned && planned.times > 0) {
      planned.times -= 1;
      if (planned.times === 0) state.failures.delete(key);
      return json({ status: planned.status, error: "Fallo simulado" }, planned.status);
    }
    if (key.endsWith("4004")) return json({ status: 400, error: "Bad Request", response: { message: ["El número no existe en WhatsApp (simulado)"] } }, 400);
    if (key.endsWith("5003")) return json({ status: 503, error: "Service Unavailable" }, 503);

    state.seq += 1;
    const id = `SIM${String(state.seq).padStart(6, "0")}`;
    const textValue =
      typeof body.text === "string"
        ? body.text
        : typeof body.caption === "string"
          ? body.caption
          : typeof body.name === "string"
            ? body.name
            : null;
    state.sent.push({ at, instance, to, kind: SEND_KIND[action], text: textValue, id });
    return json({ key: { id, remoteJid: to, fromMe: true }, status: "PENDING" }, 201);
  }

  state.other.push({ at, method, path });
  return json({ status: 404, error: "Ruta no simulada" }, 404);
};
