import { describe, it, expect } from "vitest";
import { normalizeToolsConfig, serializeToolsForScreen } from "./config";

const TAG_A = "00000000-0000-4000-8000-00000000000a";
const TAG_B = "00000000-0000-4000-8000-00000000000b";
const USER_1 = "00000000-0000-4000-8000-000000000001";
const USER_2 = "00000000-0000-4000-8000-000000000002";

const options = { existingTagIds: [TAG_A], memberIds: [USER_1] };

describe("normalizeToolsConfig", () => {
  it("valida cada configuracion contra su schema y recorta lo que no existe en la base", () => {
    const r = normalizeToolsConfig(
      {
        allowedTools: ["etiquetar_contacto", "asignar_conversacion", "derivar_a_humano", "buscar_en_conocimiento", "inexistente"],
        toolsConfig: {
          etiquetar_contacto: { allowedTagIds: [TAG_A, TAG_B], canRemove: true },
          asignar_conversacion: { allowedUserIds: [USER_1, USER_2], strategy: "round_robin", fixedUserId: null },
          inexistente: { x: 1 },
        },
      },
      options,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Las obligatorias y las de otra pestana no van en allowed_tools; lo inexistente tampoco.
    expect(r.allowedTools).toEqual(["etiquetar_contacto", "asignar_conversacion"]);
    expect(r.toolsConfig.etiquetar_contacto).toEqual({ allowedTagIds: [TAG_A], canRemove: true });
    expect(r.toolsConfig.asignar_conversacion).toEqual({ allowedUserIds: [USER_1], strategy: "round_robin", fixedUserId: null });
    expect(r.toolsConfig.inexistente).toBeUndefined();
  });

  it("una configuracion fuera de rango se rechaza con el nombre de la herramienta", () => {
    const r = normalizeToolsConfig(
      { allowedTools: [], toolsConfig: { programar_seguimiento: { maxDaysAhead: 5000 } } },
      options,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("seguimiento");
  });

  it("usuario fijo que no esta entre los habilitados se rechaza", () => {
    const r = normalizeToolsConfig(
      { allowedTools: ["asignar_conversacion"], toolsConfig: { asignar_conversacion: { allowedUserIds: [USER_1], strategy: "fixed", fixedUserId: USER_2 } } },
      { existingTagIds: [], memberIds: [USER_1, USER_2] },
    );
    expect(r.ok).toBe(false);
  });

  it("un pedido malformado se rechaza", () => {
    expect(normalizeToolsConfig({ allowedTools: "x", toolsConfig: {} }, options).ok).toBe(false);
    expect(normalizeToolsConfig({ allowedTools: [], toolsConfig: [] }, options).ok).toBe(false);
  });
});

describe("serializeToolsForScreen", () => {
  it("describe cada herramienta con sus campos y defaults, sin nada del servidor", () => {
    const tools = serializeToolsForScreen();
    const tag = tools.find((t) => t.name === "etiquetar_contacto");
    expect(tag?.defaults).toEqual({ allowedTagIds: [], canRemove: false });
    expect(tag?.configFields.map((f) => f.key)).toEqual(["allowedTagIds", "canRemove"]);
    expect(tools.find((t) => t.name === "derivar_a_humano")?.required).toBe(true);
    expect(tools.find((t) => t.name === "buscar_en_conocimiento")?.managedFrom).toBe("knowledge");
    expect(JSON.parse(JSON.stringify(tools))).toEqual(tools); // serializable tal cual
  });
});
