/**
 * Quién estuvo en una grabación, para la lista de Grabaciones: el host (quien la grabó) y los invitados. PURO: la
 * página le pasa las filas que ya leyó con la sesión.
 *
 * - Los invitados salen de la invitación del calendario que trae Fathom (`calls.attendees`).
 * - El host nunca se repite como invitado (se compara por correo y, si es del equipo, por persona).
 * - Un invitado que es del equipo lleva su `userId` (para su foto); el contacto vinculado, su foto si la tiene.
 * - Nunca se inventa un nombre: sin nombre se muestra el correo, y sin ninguno de los dos no se muestra.
 */
export interface CallPerson {
  /** Lo que se escribe: el nombre o, si no hay, el correo. */
  label: string;
  email: string | null;
  /** Si es del equipo, para su foto. */
  userId: string | null;
  /** La foto del contacto vinculado (si es él). */
  avatarUrl: string | null;
}

export interface CallParticipants {
  host: CallPerson | null;
  guests: CallPerson[];
}

interface Attendee {
  name?: string | null;
  email?: string | null;
}

const norm = (v: string | null | undefined) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export function cardParticipants(input: {
  hostUserId: string | null;
  /** El correo con el que se grabó (por si quien grabó no está en el equipo). */
  hostEmail?: string | null;
  attendees: unknown;
  contact: { name: string; email: string | null; avatarUrl: string | null } | null;
  members: Array<{ userId: string; name: string; email: string }>;
}): CallParticipants {
  const byEmail = new Map(input.members.filter((m) => m.email).map((m) => [norm(m.email), m]));
  const hostMember = input.hostUserId ? input.members.find((m) => m.userId === input.hostUserId) ?? null : null;
  const hostEmails = new Set([norm(hostMember?.email), norm(input.hostEmail)].filter(Boolean));

  const host: CallPerson | null = hostMember
    ? { label: hostMember.name, email: hostMember.email || null, userId: hostMember.userId, avatarUrl: null }
    : input.hostEmail
      ? { label: input.hostEmail, email: input.hostEmail, userId: byEmail.get(norm(input.hostEmail))?.userId ?? null, avatarUrl: null }
      : null;

  const list: Attendee[] = Array.isArray(input.attendees) ? (input.attendees as unknown[]).filter((a): a is Attendee => !!a && typeof a === "object") : [];
  const contactEmail = norm(input.contact?.email);
  const seen = new Set<string>();
  const guests: CallPerson[] = [];

  for (const a of list) {
    const email = norm(a.email);
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!email && !name) continue;
    if (email && hostEmails.has(email)) continue;
    const member = email ? byEmail.get(email) ?? null : null;
    if (member && member.userId === host?.userId) continue;
    const key = email || `n:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isContact = !!email && email === contactEmail;
    guests.push({
      label: member?.name || name || (isContact ? input.contact!.name : "") || a.email!.trim(),
      email: email ? a.email!.trim() : null,
      userId: member?.userId ?? null,
      avatarUrl: isContact ? input.contact!.avatarUrl : null,
    });
  }

  // Una grabación cuyo contacto no venía en la invitación: el contacto también estuvo.
  if (input.contact && !(contactEmail && seen.has(contactEmail)) && !guests.some((g) => g.label === input.contact!.name)) {
    guests.unshift({ label: input.contact.name, email: input.contact.email, userId: null, avatarUrl: input.contact.avatarUrl });
  }

  return { host, guests };
}

/** «Con Ana López, pedro@x.com y 2 más». Sin invitados, null. */
export function participantsLine(guests: CallPerson[], shown = 2): string | null {
  if (guests.length === 0) return null;
  const names = guests.slice(0, shown).map((g) => g.label);
  const rest = guests.length - names.length;
  if (rest <= 0) return `Con ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`}`;
  return `Con ${names.join(", ")} y ${rest === 1 ? "1 más" : `${rest} más`}`;
}
