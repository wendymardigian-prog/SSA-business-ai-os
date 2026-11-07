import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { buildFormDestinations, loadFormLinkDestinations } from "./link-destinations";

const BASE = "https://links.negocio.com";
const WS = "ws-1";
const form = (over: Record<string, unknown> = {}) => ({
  id: "f-1",
  workspace_id: WS,
  name: "Aplicación",
  slug: "aplicacion",
  type: "custom",
  status: "published",
  current_version_id: "v-1",
  contact_config: { mode: "create_or_link", update: "fill_empty", map: [] },
  ...over,
});

describe("buildFormDestinations", () => {
  it("arma el link público con el dominio del negocio", () => {
    expect(buildFormDestinations([form()], BASE)).toEqual([{ kind: "form", id: "f-1", label: "Aplicación", url: `${BASE}/f/aplicacion` }]);
  });

  it("un fin de día no tiene página pública: queda afuera", () => {
    expect(buildFormDestinations([form({ type: "eod" }), form({ id: "s", type: "survey" }), form({ id: "c", type: "contract" })], BASE).map((f) => f.id)).toEqual(["s", "c"]);
  });

  it("marca el formulario que no vincula las respuestas con contactos", () => {
    expect(buildFormDestinations([form({ contact_config: { mode: "none" } })], BASE)[0].noContact).toBe(true);
    expect(buildFormDestinations([form({ contact_config: null })], BASE)[0]).not.toHaveProperty("noContact");
  });
});

describe("loadFormLinkDestinations", () => {
  it("solo los publicados con versión, del workspace pedido, por nombre", async () => {
    const db = memoryDb({
      forms: [
        form({ id: "b", name: "Zeta" }),
        form({ id: "a", name: "Alfa" }),
        form({ id: "draft", status: "draft" }),
        form({ id: "paused", status: "paused" }),
        form({ id: "archived", status: "archived" }),
        form({ id: "nover", current_version_id: null }),
        form({ id: "ajeno", workspace_id: "ws-otro" }),
      ],
    });
    const out = await loadFormLinkDestinations(db.client as never, WS, BASE);
    expect(out.map((f) => f.id)).toEqual(["a", "b"]);
  });
});
