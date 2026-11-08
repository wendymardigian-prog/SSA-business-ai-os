import { describe, expect, it } from "vitest";
import {
  actionsOf,
  canSendEmailNow,
  countsFromStatuses,
  detailValues,
  emailStatusText,
  emptyMessage,
  FILTER_STATUSES,
  generationFiltersToQuery,
  generationRow,
  GENERATION_FILTERS,
  GENERATION_FILTER_LABELS,
  generationsRange,
  GENERATIONS_PAGE_SIZE,
  linkWorks,
  needsPolling,
  regenerateMessage,
  originOf,
  pageCount,
  parseGenerationFilters,
  retryAllLabel,
  searchOrFilter,
  stateOf,
  withGenerationFilter,
  type GenerationRecord,
  type RowContext,
} from "./generations";

const NOW = new Date("2026-11-07T15:00:00Z");

const ctx = (over: Partial<RowContext> = {}): RowContext => ({
  people: { u1: "Ana Ruiz" },
  flows: { f1: "Certificado al completar" },
  modules: { service: "Servicio" },
  can: { generate: true },
  template: { verify: true },
  now: NOW,
  timeZone: "America/Argentina/Buenos_Aires",
  ...over,
});

const record = (over: Partial<GenerationRecord> = {}): GenerationRecord => ({
  id: "d1",
  name: "Certificado · Lucía Ferreyra",
  code: "K8F2-WQ4M-7TQA",
  status: "ready",
  error: null,
  voidReason: null,
  createdAt: "2026-11-07T12:12:00Z",
  source: "manual",
  sourceRef: { kind: "user", user_id: "u1" },
  subjectName: "Lucía Ferreyra",
  subjectDetail: "lucia@ejemplo.com",
  published: false,
  attempts: 0,
  emailStatus: null,
  emailRequested: false,
  canEmail: true,
  ...over,
});

describe("«Cómo se generó» para los cuatro orígenes (F53)", () => {
  it("a mano: la persona", () => {
    expect(originOf(record(), ctx())).toEqual({ text: "A mano · Ana Ruiz", href: null });
    expect(originOf(record({ sourceRef: { kind: "user", user_id: "borrada" } }), ctx())).toEqual({ text: "A mano", href: null });
  });

  it("automatización: su nombre y el link a la corrida", () => {
    const g = record({ source: "automation", sourceRef: { kind: "automation", flow_id: "f1", session_id: "s-9", node_id: "step-1" } });
    expect(originOf(g, ctx())).toEqual({ text: "Automatización «Certificado al completar»", href: "/dashboard/flows/f1/ejecuciones?ejecucion=s-9" });
  });

  it("una automatización que ya no se puede leer deja el texto genérico y el link sin la corrida", () => {
    const g = record({ source: "automation", sourceRef: { kind: "automation", flow_id: "otra", session_id: "s-9" } });
    expect(originOf(g, ctx())).toEqual({ text: "Automatización", href: "/dashboard/flows/otra/ejecuciones?ejecucion=s-9" });
    expect(originOf(record({ source: "automation", sourceRef: null }), ctx())).toEqual({ text: "Automatización", href: null });
  });

  it("para varios", () => {
    expect(originOf(record({ source: "bulk", sourceRef: { kind: "bulk", batch_id: "b", user_id: "u1" } }), ctx())).toEqual({ text: "Para varios · Ana Ruiz", href: null });
    expect(originOf(record({ source: "bulk", sourceRef: { kind: "bulk", batch_id: "b", user_id: null } }), ctx())).toEqual({ text: "Para varios", href: null });
  });

  it("un módulo: su nombre en pantalla, o el del módulo con mayúscula", () => {
    expect(originOf(record({ source: "module", sourceRef: { kind: "module", module: "service", id: "r1" } }), ctx())).toEqual({ text: "Servicio", href: null });
    expect(originOf(record({ source: "module", sourceRef: { kind: "module", module: "tienda", id: "r1" } }), ctx())).toEqual({ text: "Tienda", href: null });
  });
});

describe("el estado con su motivo (F53)", () => {
  it("generado, en proceso, fallido (con el error en rojo) y anulado (con su motivo)", () => {
    expect(stateOf(record())).toEqual({ key: "ready", label: "Generado", tone: "ok", reason: null });
    for (const status of ["queued", "rendering"] as const) expect(stateOf(record({ status }))).toEqual({ key: "processing", label: "En proceso", tone: "act", reason: null });
    expect(stateOf(record({ status: "failed", error: "Falta: Nombre como lo quiere en el certificado" }))).toEqual({ key: "failed", label: "Falló", tone: "bad", reason: "Falta: Nombre como lo quiere en el certificado" });
    expect(stateOf(record({ status: "void", voidReason: "Nombre mal escrito" }))).toEqual({ key: "void", label: "Anulado", tone: "off", reason: "Motivo: Nombre mal escrito" });
  });

  it("una fallida sin motivo guardado igual dice algo", () => {
    expect(stateOf(record({ status: "failed", error: null })).reason).toBe("No se pudo generar la pieza.");
  });
});

describe("las acciones de cada fila (F53, F54)", () => {
  it("una lista con verificación: Ver, copiar link, Anular y Volver a generar", () => {
    expect(actionsOf(record(), ctx())).toEqual(["view", "copy_link", "void", "regenerate", "detail"]);
  });

  it("sin verificación no hay «Anular»; y sin publicar ni verificar el link no funciona, así que no hay Ver", () => {
    expect(actionsOf(record({ published: true }), ctx({ template: { verify: false } }))).toEqual(["view", "copy_link", "regenerate", "detail"]);
    expect(actionsOf(record({ published: false }), ctx({ template: { verify: false } }))).toEqual(["regenerate", "detail"]);
  });

  it("una fallida ofrece Reintentar y Detalle", () => {
    expect(actionsOf(record({ status: "failed" }), ctx())).toEqual(["retry", "detail"]);
  });

  it("una anulada solo se puede ver; una que se está armando solo el detalle", () => {
    expect(actionsOf(record({ status: "void" }), ctx())).toEqual(["view", "detail"]);
    expect(actionsOf(record({ status: "queued" }), ctx())).toEqual(["detail"]);
    expect(actionsOf(record({ status: "rendering" }), ctx())).toEqual(["detail"]);
  });

  it("sin el permiso de generar se OCULTA lo que cambia algo: queda ver, copiar y detalle", () => {
    const noGenerate = ctx({ can: { generate: false } });
    expect(actionsOf(record(), noGenerate)).toEqual(["view", "copy_link", "detail"]);
    expect(actionsOf(record({ status: "failed" }), noGenerate)).toEqual(["detail"]);
  });

  it("el link funciona si está publicada o si la plantilla verifica", () => {
    expect(linkWorks({ published: false }, { verify: true })).toBe(true);
    expect(linkWorks({ published: true }, { verify: false })).toBe(true);
    expect(linkWorks({ published: false }, { verify: false })).toBe(false);
  });
});

describe("generationRow: lo que dibuja la tabla o la tarjeta", () => {
  it("junta cuándo, para quién, cómo se generó, el estado y las acciones", () => {
    const row = generationRow(record({ status: "failed", error: "No se pudo armar el PDF (tiempo agotado)." }), ctx());
    expect(row).toMatchObject({
      id: "d1",
      when: "hoy 09:12",
      para: { name: "Lucía Ferreyra", detail: "lucia@ejemplo.com" },
      origin: { text: "A mano · Ana Ruiz", href: null },
      state: { label: "Falló", reason: "No se pudo armar el PDF (tiempo agotado)." },
      actions: ["retry", "detail"],
      processing: false,
      code: "K8F2-WQ4M-7TQA",
    });
  });

  it("sin nombre dice «Sin nombre» y una que se está armando se marca para volver a leerla", () => {
    const row = generationRow(record({ status: "queued", subjectName: null, subjectDetail: null }), ctx());
    expect(row.para).toEqual({ name: "Sin nombre", detail: null });
    expect(row.processing).toBe(true);
  });
});

describe("filtros, contadores y páginas (F53)", () => {
  it("los cinco filtros, en el orden del plano", () => {
    expect(GENERATION_FILTERS.map((f) => GENERATION_FILTER_LABELS[f])).toEqual(["Todas", "Generadas", "Fallidas", "En proceso", "Anuladas"]);
    expect(FILTER_STATUSES.en_proceso).toEqual(["queued", "rendering"]);
    expect(FILTER_STATUSES.todas).toBeNull();
  });

  it("los contadores salen de cuántas hay en cada estado", () => {
    expect(countsFromStatuses({ ready: 10, failed: 2, queued: 1, rendering: 2, void: 3 })).toEqual({ todas: 18, generadas: 10, fallidas: 2, en_proceso: 3, anuladas: 3 });
    expect(countsFromStatuses({})).toEqual({ todas: 0, generadas: 0, fallidas: 0, en_proceso: 0, anuladas: 0 });
  });

  it("la URL: lo que no existe vuelve al valor de siempre y todo se valida", () => {
    expect(parseGenerationFilters(new URLSearchParams("tab=generaciones&estado=fallidas&q=%20Lucía%20%20F&pagina=3"))).toEqual({ estado: "fallidas", q: "Lucía F", page: 3 });
    expect(parseGenerationFilters({ estado: "inventado", pagina: "-4", q: "x".repeat(300) })).toEqual({ estado: "todas", q: "x".repeat(100), page: 1 });
    expect(parseGenerationFilters({})).toEqual({ estado: "todas", q: "", page: 1 });
  });

  it("escribir la URL: el valor de siempre no se escribe y la pestaña va siempre", () => {
    expect(generationFiltersToQuery({ estado: "todas", q: "", page: 1 })).toBe("tab=generaciones");
    expect(generationFiltersToQuery({ estado: "anuladas", q: "Ana", page: 2 })).toBe("tab=generaciones&estado=anuladas&q=Ana&pagina=2");
  });

  it("cambiar el filtro o la búsqueda vuelve a la página 1", () => {
    expect(withGenerationFilter({ estado: "todas", q: "", page: 4 }, { estado: "fallidas" })).toEqual({ estado: "fallidas", q: "", page: 1 });
  });

  it("de a 50", () => {
    expect(GENERATIONS_PAGE_SIZE).toBe(50);
    expect(generationsRange(1)).toEqual({ from: 0, to: 49 });
    expect(generationsRange(3)).toEqual({ from: 100, to: 149 });
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
  });

  it("la búsqueda por nombre o código no rompe el `or` de PostgREST", () => {
    expect(searchOrFilter("   ")).toBeNull();
    expect(searchOrFilter("Lucía")).toBe("name.ilike.%Lucía%,code.ilike.%Lucía%");
    expect(searchOrFilter("a,b(c)%_")).toBe("name.ilike.%a b c%,code.ilike.%a b c%");
  });

  it("un código escrito sin guiones también se encuentra", () => {
    expect(searchOrFilter("k8f2wq4m")).toBe("name.ilike.%k8f2wq4m%,code.ilike.%k8f2wq4m%,code.ilike.%K8F2-WQ4M%");
    expect(searchOrFilter("K8F2-WQ4M")).toBe("name.ilike.%K8F2-WQ4M%,code.ilike.%K8F2-WQ4M%");
  });

  it("«Reintentar las fallidas (N)» solo aparece si hay fallidas", () => {
    expect(retryAllLabel(0)).toBeNull();
    expect(retryAllLabel(3)).toBe("Reintentar las fallidas (3)");
  });

  it("vuelve a leer sola mientras haya algo «En proceso»", () => {
    expect(needsPolling([{ status: "ready" }, { status: "failed" }])).toBe(false);
    expect(needsPolling([{ status: "ready" }, { status: "rendering" }])).toBe(true);
    expect(needsPolling([{ status: "queued" }])).toBe(true);
    expect(needsPolling([])).toBe(false);
  });

  it("lo que se dice cuando no hay nada", () => {
    expect(emptyMessage({ estado: "todas", q: "", page: 1 }, 0, "Emitir certificado")).toBe("Todavía no se generó nada con esta plantilla. Tocá «Emitir certificado» para generar la primera.");
    expect(emptyMessage({ estado: "fallidas", q: "", page: 1 }, 8, "Emitir certificado")).toBe("Nada con este filtro.");
    expect(emptyMessage({ estado: "todas", q: "zzz", page: 1 }, 8, "Emitir certificado")).toBe("No encontramos piezas con esa búsqueda.");
  });
});

describe("el detalle (F54)", () => {
  it("las variables con lo que valieron, vacías como «—»", () => {
    expect(detailValues({ nombre: "Lu", vacia: "  " }, { nombre: "Nombre", vacia: "Vacía", falta: "No está" })).toEqual([
      { key: "nombre", label: "Nombre", value: "Lu" },
      { key: "vacia", label: "Vacía", value: "—" },
      { key: "falta", label: "No está", value: "—" },
    ]);
  });

  it("el estado del email", () => {
    expect(emailStatusText({ emailStatus: "sent", emailRequested: true })).toBe("Email enviado");
    expect(emailStatusText({ emailStatus: "failed", emailRequested: true })).toBe("El email no salió");
    expect(emailStatusText({ emailStatus: null, emailRequested: true })).toBe("Se manda cuando la pieza esté lista");
    expect(emailStatusText({ emailStatus: null, emailRequested: false })).toBe("No se pidió mandar email");
  });

  it("«Mandar el email ahora»: lista, con a quién mandarle, sin que haya salido y con el permiso", () => {
    const base = { status: "ready" as const, emailStatus: null, canEmail: true };
    expect(canSendEmailNow(base, ctx())).toBe(true);
    expect(canSendEmailNow({ ...base, emailStatus: "failed" }, ctx())).toBe(true);
    expect(canSendEmailNow({ ...base, emailStatus: "sent" }, ctx())).toBe(false);
    expect(canSendEmailNow({ ...base, status: "failed" }, ctx())).toBe(false);
    expect(canSendEmailNow({ ...base, canEmail: false }, ctx())).toBe(false);
    expect(canSendEmailNow(base, ctx({ can: { generate: false } }))).toBe(false);
  });
});

describe("«Volver a generar» (F47)", () => {
  it("el texto de confirmación usa el género del tipo de documento", () => {
    expect(regenerateMessage({ verify: true, docType: "certificado" }, "Lucía")).toBe("Se genera un certificado nuevo para Lucía con los datos de hoy y se anula el anterior («Reemplazado por» el código nuevo).");
    expect(regenerateMessage({ verify: true, docType: "constancia" }, "Lucía")).toBe("Se genera una constancia nueva para Lucía con los datos de hoy y se anula la anterior («Reemplazado por» el código nuevo).");
    expect(regenerateMessage({ verify: true, docType: "diploma" }, "Lucía")).toContain("un diploma nuevo");
    expect(regenerateMessage({ verify: true, docType: "otro" }, "Lucía")).toContain("una pieza nueva");
  });

  it("sin verificación no se anula nada", () => {
    expect(regenerateMessage({ verify: false, docType: null }, "Lucía")).toBe("Se genera una pieza nueva para Lucía con los datos de hoy.");
  });
});
