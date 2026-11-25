import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aggregate, planQuery } from "./query";
import type { TableInfo } from "./schema";
import { checkConfirmation, issueConfirmation, stableJson, CONFIRM_TTL_MS } from "./confirm";
import { allActions, findAction, searchActions, visibleFor } from "./catalog";
import { nextNavigationMessage, toJsonText } from "./result";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const contacts: TableInfo = {
  schema: "public",
  name: "contacts",
  ref: "contacts",
  description: null,
  columns: ["id", "workspace_id", "display_name", "setter_status", "created_at", "score"].map((name) => ({ name, type: "string", format: null, required: false, description: null })),
};

describe("consulta guiada", () => {
  it("rechaza columnas que no existen (nunca llegan al select)", () => {
    const r = planQuery({ tabla: "contacts", columnas: ["id", "password_hash"] }, contacts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("password_hash");
  });

  it("filtra por el negocio activo salvo que se pida lo contrario", () => {
    const a = planQuery({ tabla: "contacts", columnas: ["id"] }, contacts);
    const b = planQuery({ tabla: "contacts", columnas: ["id"], todos_los_negocios: true }, contacts);
    expect(a.ok && a.plan.workspaceFilter).toBe(true);
    expect(b.ok && b.plan.workspaceFilter).toBe(false);
  });

  it("sin columnas ni agrupación pide columnas", () => {
    expect(planQuery({ tabla: "contacts" }, contacts).ok).toBe(false);
  });

  it("valida in / is", () => {
    expect(planQuery({ tabla: "contacts", columnas: ["id"], filtros: [{ columna: "id", op: "in", valor: "x" }] }, contacts).ok).toBe(false);
    expect(planQuery({ tabla: "contacts", columnas: ["id"], filtros: [{ columna: "id", op: "is", valor: "x" }] }, contacts).ok).toBe(false);
  });

  it("agrupa y calcula", () => {
    const rows = [
      { setter_status: "a", score: 1 },
      { setter_status: "a", score: "3" },
      { setter_status: "b", score: null },
      { setter_status: null, score: 5 },
    ];
    const out = aggregate(rows, ["setter_status"], [{ op: "count" }, { op: "sum", columna: "score" }, { op: "avg", columna: "score" }]);
    expect(out).toEqual([
      { setter_status: "a", count: 2, sum_score: 4, avg_score: 2 },
      { setter_status: "b", count: 1, sum_score: null, avg_score: null },
      { setter_status: null, count: 1, sum_score: 5, avg_score: 5 },
    ]);
    expect(aggregate([], [], [{ op: "count" }])).toEqual([{ count: 0 }]);
  });
});

describe("confirmación de lo delicado", () => {
  const subject = { userId: "u1", workspaceId: "w1", action: "contacts#deleteContact", args: [{ id: "c1", b: 2, a: 1 }] };

  it("sirve para lo mismo, con los argumentos en cualquier orden de claves", () => {
    const token = issueConfirmation(subject, 1000);
    expect(checkConfirmation(token, { ...subject, args: [{ a: 1, b: 2, id: "c1" }] }, 2000).ok).toBe(true);
  });

  it("no sirve para otros argumentos, otra acción, otra persona u otro negocio", () => {
    const token = issueConfirmation(subject, 1000);
    expect(checkConfirmation(token, { ...subject, args: [{ id: "c2", a: 1, b: 2 }] }, 2000)).toEqual({ ok: false, reason: "mismatch" });
    expect(checkConfirmation(token, { ...subject, action: "contacts#mergeContacts" }, 2000).ok).toBe(false);
    expect(checkConfirmation(token, { ...subject, userId: "u2" }, 2000).ok).toBe(false);
    expect(checkConfirmation(token, { ...subject, workspaceId: "w2" }, 2000).ok).toBe(false);
  });

  it("vence a los 5 minutos y rechaza basura", () => {
    const token = issueConfirmation(subject, 1000);
    expect(checkConfirmation(token, subject, 1000 + CONFIRM_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(checkConfirmation("hola", subject).ok).toBe(false);
    expect(checkConfirmation(null, subject).ok).toBe(false);
  });

  it("JSON estable", () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
  });
});

describe("catálogo de acciones", () => {
  it("está al día con lib/actions (node scripts/build-mcp-catalog.mjs)", () => {
    expect(() => execFileSync(process.execPath, ["scripts/build-mcp-catalog.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  }, 60_000);

  it("no ofrece contraseñas, invitaciones, links públicos ni cambiar el negocio por cookie", () => {
    const ids = allActions().map((a) => a.id);
    for (const banned of ["password-reset#requestPasswordReset", "password-reset#setNewPassword", "account#changeMyPassword", "workspace#switchWorkspace", "team#registerFromInvite", "team#acceptInvite", "email-unsubscribe#confirmUnsubscribe", "mcp-connections#approveMcpAuthorization"]) {
      expect(ids).not.toContain(banned);
    }
  });

  it("toda acción está clasificada y lo que borra, manda, invita o toca roles es delicado", () => {
    for (const a of allActions()) expect(["read", "write", "sensitive"]).toContain(a.kind);
    for (const id of ["roles#patchRole", "team#inviteTeamMember", "whatsapp-group-inbox#sendGroupMessage"]) expect(findAction(id)?.kind).toBe("sensitive");
    // Mandarse una prueba a uno mismo no es delicado (overrides.json).
    for (const a of allActions()) if (/^(delete|remove|send|invite|publish|merge|restore)/i.test(a.name) && !/^sendMyTest/.test(a.name)) expect(a.kind, a.id).toBe("sensitive");
  });

  it("solo ofrece lo que el rol puede intentar", () => {
    const none = visibleFor(() => false);
    expect(none.every((a) => a.permissions.length === 0)).toBe(true);
    expect(visibleFor(() => true).length).toBe(allActions().length);
    expect(searchActions(allActions(), "upload document").some((a) => a.id === "knowledge#uploadDocument")).toBe(true);
  });

  it("las acciones que la ruta del conector puede cargar son exactamente las del catálogo", () => {
    const loaders = readFileSync("lib/mcp/action-loaders.generated.ts", "utf8");
    for (const file of new Set(allActions().map((a) => a.file))) expect(loaders).toContain(`"${file}":`);
  });
});

describe("respuestas", () => {
  it("corta lo enorme con aviso y aguanta lo que no es JSON", () => {
    const big = toJsonText({ x: "a".repeat(200) }, 50);
    expect(big).toContain("respuesta cortada");
    expect(toJsonText({ n: BigInt(3), m: new Map([["a", 1]]) })).toContain('"n": "3"');
  });

  it("traduce un redirect de Next en vez de dar un error de servidor", () => {
    expect(nextNavigationMessage({ digest: "NEXT_REDIRECT;replace;/login;307;" })).toContain("sesión");
    expect(nextNavigationMessage({ digest: "NEXT_REDIRECT;replace;/dashboard?inicio=1;307;" })).toContain("acceso");
    expect(nextNavigationMessage(new Error("x"))).toBeNull();
  });
});
