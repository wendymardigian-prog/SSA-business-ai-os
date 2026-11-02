import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { newField } from "@/lib/forms/fields";
import type { LoadedForm, SaveInput, SubmitPorts } from "@/lib/forms/submit";

/**
 * La ruta del envío con DOS negocios en la misma instalación, cada uno con su web:
 * el origen de uno no puede mandar a los formularios del otro (403, sin headers de CORS),
 * y el suyo sí (con el origen exacto). Más el tope del cuerpo antes de leer.
 */

const APP = "https://app.ejemplo.com";
const ORIGIN_A = "https://web-a.com";
const ORIGIN_B = "https://web-b.com";

const mocks = vi.hoisted(() => ({
  saves: [] as unknown[],
  loadPublishedForm: vi.fn(),
}));

function form(id: string, workspaceId: string, slug: string, over: Partial<LoadedForm> = {}): LoadedForm {
  return {
    id,
    workspaceId,
    name: slug,
    type: "custom",
    slug,
    versionId: "3f0c1c2e-0000-4000-8000-0000000000aa",
    versionNumber: 1,
    fields: [{ ...newField("email", "email", "Email"), required: true }],
    success: { mode: "message", title: "Gracias", body: "" },
    workspaceTimezone: "UTC",
    contactConfig: { mode: "none", update: "fill_empty", map: [] },
    customFields: [],
    notifyEnabled: false,
    notifyUserIds: [],
    contract: null,
    ...over,
  };
}

const FORMS: Record<string, LoadedForm> = {
  "form-a": form("fa", "ws-a", "form-a"),
  "form-b": form("fb", "ws-b", "form-b"),
  "con-archivo": form("fc", "ws-a", "con-archivo", { fields: [newField("file", "cv", "CV")] }),
};
const ORIGINS: Record<string, string[]> = { "ws-a": [ORIGIN_A], "ws-b": [ORIGIN_B] };

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => APP }));
vi.mock("@/lib/http/workspace-origins", () => ({
  originsForWorkspace: async (_s: unknown, ws: string) => ({ allowedOrigins: (ORIGINS[ws] ?? []).map((origin) => ({ origin, dev: false })) }),
}));
vi.mock("@/lib/forms/site-origins", () => ({
  workspaceOfPublishedForm: async (_s: unknown, slug: string) => FORMS[slug]?.workspaceId ?? null,
}));
vi.mock("@/lib/forms/server-ports", () => ({
  loadPublishedForm: mocks.loadPublishedForm,
  createSubmitPorts: (): SubmitPorts => ({
    limit: async (spec) => ({ allowed: true, count: 1, max: spec.max }),
    limitKeys: { submit: (ip) => `s:${ip}`, submitForm: (f, ip) => `sf:${f}:${ip}` },
    hashIp: () => "h",
    loadForm: async () => null,
    findSubmission: async () => null,
    recordRejected: async () => undefined,
    upload: async () => true,
    uploadContractFile: async () => true,
    discardContractFile: async () => undefined,
    save: async (input: SaveInput) => {
      mocks.saves.push(input);
      return { ok: true as const, duplicate: false, submissionId: "sub-1", status: "no_contact", contactId: null, contactCreated: false, matchedBy: null, conflictContactId: null };
    },
    verifyLink: async () => null,
    recordTouch: async () => undefined,
    notify: async () => undefined,
    newId: () => "id-1",
  }),
}));

import { POST, OPTIONS } from "./route";

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const payload = (over: Record<string, unknown> = {}) => ({
  idempotency_key: "3f0c1c2e-0000-4000-8000-000000000001",
  origin: "site",
  answers: { email: "a@x.com" },
  ...over,
});

function jsonPost(slug: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${APP}/api/public/forms/${slug}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.ejemplo.com", "x-forwarded-proto": "https", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.saves.length = 0;
  mocks.loadPublishedForm.mockReset();
  mocks.loadPublishedForm.mockImplementation(async (_s: unknown, slug: string) => FORMS[slug] ?? null);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("OPTIONS (el preflight)", () => {
  it("con el origen del negocio dueño: 204 con el origen exacto", async () => {
    const res = await OPTIONS(new NextRequest(`${APP}/api/public/forms/form-a/submit`, { method: "OPTIONS", headers: { origin: ORIGIN_A } }), ctx("form-a"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN_A);
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(res.headers.get("access-control-max-age")).toBe("600");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("con el origen de OTRO negocio: 204 sin headers (el navegador bloquea)", async () => {
    const res = await OPTIONS(new NextRequest(`${APP}/api/public/forms/form-a/submit`, { method: "OPTIONS", headers: { origin: ORIGIN_B } }), ctx("form-a"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST: dos negocios aislados", () => {
  it("la web A manda al formulario de A (JSON, sin version_id): 200 con CORS", async () => {
    const res = await POST(jsonPost("form-a", payload(), { origin: ORIGIN_A }), ctx("form-a"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN_A);
    expect(await res.json()).toMatchObject({ ok: true, submission_id: "sub-1" });
    expect(mocks.saves).toHaveLength(1);
  });

  it("la web B NO puede mandar al formulario de A: 403, sin CORS y sin guardar", async () => {
    const res = await POST(jsonPost("form-a", payload(), { origin: ORIGIN_B }), ctx("form-a"));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(await res.json()).toEqual({ ok: false, error: "origin_not_allowed" });
    expect(mocks.saves).toEqual([]);
  });

  it("y al revés: la web A NO puede mandar al formulario de B", async () => {
    const res = await POST(jsonPost("form-b", payload(), { origin: ORIGIN_A }), ctx("form-b"));
    expect(res.status).toBe(403);
    expect(mocks.saves).toEqual([]);
  });

  it("sin Origin (curl) sigue andando, sin headers de CORS", async () => {
    const res = await POST(jsonPost("form-a", payload()), ctx("form-a"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("la propia app (multipart, como /f/<slug>) sigue igual", async () => {
    const body = new FormData();
    body.set("payload", JSON.stringify(payload({ origin: "public_page", version_id: "3f0c1c2e-0000-4000-8000-0000000000aa" })));
    const res = await POST(
      new NextRequest(`${APP}/api/public/forms/form-a/submit`, { method: "POST", headers: { origin: APP, host: "app.ejemplo.com", "x-forwarded-proto": "https" }, body }),
      ctx("form-a"),
    );
    expect(res.status).toBe(200);
    expect(mocks.saves).toHaveLength(1);
  });

  it("un JSON ilegible es 400 con CORS (la web puede leer el error)", async () => {
    const res = await POST(jsonPost("form-a", "{no es json", { origin: ORIGIN_A }), ctx("form-a"));
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN_A);
  });
});

describe("POST: el tope del cuerpo, antes de leerlo", () => {
  it("un formulario sin archivos con más de 64 KB declarados: 413 sin guardar", async () => {
    const res = await POST(jsonPost("form-a", payload({ answers: { email: "a@x.com", extra: "x".repeat(70 * 1024) } }), { origin: ORIGIN_A }), ctx("form-a"));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, error: "payload_too_large" });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN_A);
    expect(mocks.saves).toEqual([]);
  });

  it("más del tope grande DECLARADO: 413 sin buscar el formulario ni leer", async () => {
    const req = jsonPost("con-archivo", "{}", { origin: ORIGIN_A, "content-length": String(36 * 1024 * 1024) });
    const res = await POST(req, ctx("con-archivo"));
    expect(res.status).toBe(413);
    expect(mocks.loadPublishedForm).not.toHaveBeenCalled();
  });

  it("un cuerpo sin tamaño declarado se corta al pasarse (413)", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (pulled >= 1000) return c.close();
          pulled += 1;
          c.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 },
    );
    const req = new NextRequest(`${APP}/api/public/forms/form-a/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN_A },
      body: stream,
      duplex: "half",
    } as never);
    const res = await POST(req, ctx("form-a"));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(100);
    expect(mocks.saves).toEqual([]);
  });
});
