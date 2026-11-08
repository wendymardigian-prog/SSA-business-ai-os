/**
 * Datos de prueba de las generaciones (DS6): un negocio, una plantilla de certificado con una variable propia, tres
 * contactos y una base en memoria que reparte códigos como lo hace el trigger de `designs`. Solo para tests. Nombres
 * inventados.
 */

import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { emptyDoc, type DesignDoc } from "../doc/schema";

export const WS = "11111111-2222-4333-8444-555555555555";
export const OTHER_WS = "99999999-2222-4333-8444-555555555555";
export const TEMPLATE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const USER = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
export const LUCIA = "c0000001-1111-4111-8111-cccccccccccc";
export const DIEGO = "c0000002-1111-4111-8111-cccccccccccc";
export const TOMAS = "c0000003-1111-4111-8111-cccccccccccc";
export const FOREIGN_CONTACT = "c0000009-1111-4111-8111-cccccccccccc";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let seq = 0;

/** Un código con la forma de `private.design_new_code()` (tres grupos de cuatro, base32 Crockford), siempre distinto. */
export function fakeCode(): string {
  seq += 1;
  let n = seq;
  let tail = "";
  for (let i = 0; i < 4; i++) {
    tail = ALPHABET[n % 32] + tail;
    n = Math.floor(n / 32);
  }
  return `K8F2-WQ4M-${tail}`;
}

/** El documento de la plantilla: una carta apaisada con el nombre, la fecha y el código. */
export function templateDoc(text = "Se otorga el presente a {{nombre_en_el_certificado}} · {{design.issued_on}} · {{design.code}}"): DesignDoc {
  const doc = emptyDoc("carta_h");
  doc.pages[0].id = "pg_aaaaaa";
  doc.pages[0].elements.push({
    id: "el_aaaaaa",
    type: "text",
    x: 50,
    y: 50,
    w: 80,
    text,
    font: { family: "Inter", weight: 400 },
    size: 40,
    align: "center",
    color: "#111111",
  });
  return doc;
}

export interface FixtureOptions {
  template?: Record<string, unknown>;
  designs?: Record<string, unknown>[];
  workspace?: Record<string, unknown>;
  contacts?: Record<string, unknown>[];
  extra?: Record<string, Record<string, unknown>[]>;
}

export const NAMES = { [LUCIA]: "Lucía Ferreyra", [DIEGO]: "Diego Salas", [TOMAS]: "Tomás Ruiz" } as const;

/** Una base en memoria con el negocio, la plantilla, tres contactos (y uno de OTRO negocio). */
export function generationDb(opts: FixtureOptions = {}): MemoryDb {
  return memoryDb(
    {
      workspaces: [{ id: WS, name: "Academia Ejemplo", brand_name: null, timezone: "America/Argentina/Buenos_Aires", ...opts.workspace }],
      design_templates: [
        {
          id: TEMPLATE,
          workspace_id: WS,
          name: "Certificado del programa",
          format: "carta_h",
          doc: templateDoc(),
          custom_vars: [{ key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado", sample: "Ana Pérez", default: null }],
          date_format: "long",
          verify: true,
          doc_type: "certificado",
          doc_type_label: null,
          allow_download: true,
          archived_at: null,
          created_at: "2026-11-01T10:00:00.000Z",
          updated_at: "2026-11-01T10:00:00.000Z",
          ...opts.template,
        },
      ],
      contacts: opts.contacts ?? [
        { id: LUCIA, workspace_id: WS, display_name: "Lucía Ferreyra", email: "lucia@ejemplo.com", phone: "+5491155550001", deleted_at: null, is_anonymous: false },
        { id: DIEGO, workspace_id: WS, display_name: "Diego Salas", email: "diego@ejemplo.com", phone: null, deleted_at: null, is_anonymous: false },
        { id: TOMAS, workspace_id: WS, display_name: "Tomás Ruiz", email: null, phone: null, deleted_at: null, is_anonymous: false },
        { id: FOREIGN_CONTACT, workspace_id: OTHER_WS, display_name: "Persona de otro negocio", email: null, phone: null, deleted_at: null, is_anonymous: false },
      ],
      designs: opts.designs ?? [],
      ...(opts.extra ?? {}),
    },
    {
      generated: {
        designs: (row) => {
          if (!row.code) row.code = fakeCode();
        },
      },
    },
  );
}

/**
 * Cambia lo que devuelve `from(tabla)` del cliente en memoria (para simular una falla de la base en una tabla). `wrap`
 * recibe la tabla y el `from` original.
 */
export function interceptFrom(db: MemoryDb, wrap: (table: string, original: (table: string) => unknown) => unknown): void {
  const client = db.client as unknown as { from: (table: string) => unknown };
  const original = client.from.bind(client);
  client.from = (table: string) => wrap(table, original);
}

/** Una generación ya existente (por defecto, lista, de Lucía). */
export function generationRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `d0000000-1111-4111-8111-${String(++seq).padStart(12, "0")}`,
    workspace_id: WS,
    name: "Certificado del programa · Lucía Ferreyra",
    format: "carta_h",
    doc: templateDoc(),
    rev: 0,
    origin: "template",
    template_id: TEMPLATE,
    subject_contact_id: LUCIA,
    subject_ref: null,
    values: { nombre_en_el_certificado: "Lucía Ferreyra" },
    status: "ready",
    error: null,
    attempts: 0,
    source: "manual",
    source_ref: { kind: "user", user_id: USER },
    email_status: null,
    published: false,
    allow_download: true,
    code: fakeCode(),
    renders: {},
    void_reason: null,
    created_by: USER,
    created_at: "2026-11-07T12:00:00.000Z",
    archived_at: null,
    ...over,
  };
}
