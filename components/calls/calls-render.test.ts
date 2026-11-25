import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Los componentes cliente se dibujan en el servidor para comprobar que no rompen al montarse (sin navegador).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/llamadas", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/calls-edit", () => ({ changeCallTypeMany: vi.fn(), classifyAndAnalyzeCalls: vi.fn(), reclassifyCalls: vi.fn() }));

import { CallPeople } from "./call-people";
import { CallsBulkBar, type BulkItem } from "./calls-bulk-bar";
import { CallPanelSkeleton } from "./call-panel";
import { CallsAiAgentsButton } from "./calls-ai-agents";

const groups = [{ areaId: "a1", areaName: "Ventas", types: [{ id: "t1", name: "Cierre" }] }] as never;
const item = (n: number): BulkItem => ({ callId: `c${n}`, title: `Grabación ${n}`, subtitle: "hoy", categoryId: null, needsType: n % 2 === 0 });

describe("componentes de Grabaciones", () => {
  it("las personas: foto o iniciales del host, invitados y «+N»", () => {
    const html = renderToStaticMarkup(
      createElement(CallPeople, {
        participants: {
          host: { label: "Laura Prueba", email: "l@x.test", userId: null, avatarUrl: null },
          guests: Array.from({ length: 5 }, (_, i) => ({ label: `Invitado ${i}`, email: `i${i}@x.test`, userId: null, avatarUrl: null })),
        },
      }),
    );
    expect(html).toContain("+2");
    expect(html).toContain("Con Invitado 0, Invitado 1 y 3 más");
  });

  it("sin nadie muestra un guion", () => {
    expect(renderToStaticMarkup(createElement(CallPeople, { participants: { host: null, guests: [] } }))).toContain("—");
  });

  it("la barra de selección es roja y ofrece lo que corresponde al permiso", () => {
    const base = { selected: [item(1), item(2)], groups, onClear: () => {}, onResult: () => {}, onDelete: () => {} };
    const full = renderToStaticMarkup(createElement(CallsBulkBar, { ...base, canEdit: true, canDelete: true }));
    expect(full).toContain("bg-red-600");
    for (const text of ["2 seleccionadas", "Cambiar tipo", "Volver a clasificar", "Analizar con IA", "Eliminar", "Quitar selección"]) expect(full).toContain(text);
    const readOnly = renderToStaticMarkup(createElement(CallsBulkBar, { ...base, canEdit: false, canDelete: true }));
    expect(readOnly).not.toContain("Analizar con IA");
    expect(readOnly).toContain("Eliminar");
  });

  it("el esqueleto del panel dice que no existe cuando no se encontró", () => {
    expect(renderToStaticMarkup(createElement(CallPanelSkeleton, { missing: true, onClose: () => {} }))).toContain("No encontré esa grabación");
    expect(renderToStaticMarkup(createElement(CallPanelSkeleton, { missing: false, onClose: () => {} }))).toContain("aria-busy");
  });

  it("el botón Agentes IA lista los agentes con su estado", () => {
    const html = renderToStaticMarkup(
      createElement(CallsAiAgentsButton, { agents: [{ key: "classifier", name: "Clasificador de grabaciones", role: "Decide el tipo", status: "Automático", tone: "on", href: "/dashboard/agents/tareas/call_classification" }] }),
    );
    expect(html).toContain("Agentes IA");
  });
});
