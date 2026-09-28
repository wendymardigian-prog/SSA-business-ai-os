/**
 * Tests for buildDesiredTriggers, the node-graph -> `triggers` rows mapping run
 * on publish.
 *
 * The interesting case is "also match in DMs": one comment_keyword node has to
 * emit a second row typed `keyword`, because the runtime matcher keys the DM
 * path off that type. Get it wrong and either the DM never fires or the comment
 * flow answers twice.
 */

import { describe, it, expect } from "vitest";
import { buildDesiredTriggers } from "./flow-triggers";

const FLOW_ID = "flow-1";

function triggerNode(data: Record<string, unknown>) {
  return { id: "n1", type: "trigger", data };
}

describe("buildDesiredTriggers", () => {
  it("maps a comment_keyword node to a single row when the DM door is off", () => {
    const rows = buildDesiredTriggers(
      [triggerNode({ triggerType: "comment_keyword", keywords: [{ value: "focus", matchType: "contains" }] })],
      FLOW_ID,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("comment_keyword");
  });

  it("emits a second `keyword` row when the DM door is on", () => {
    const rows = buildDesiredTriggers(
      [
        triggerNode({
          triggerType: "comment_keyword",
          alsoMatchInDms: true,
          keywords: [{ value: "focus", matchType: "contains" }],
        }),
      ],
      FLOW_ID,
    );

    expect(rows.map((r) => r.type)).toEqual(["comment_keyword", "keyword"]);
    expect(rows[1].config).toMatchObject({ keywords: [{ value: "focus", matchType: "contains" }] });
    expect(rows[1].flow_id).toBe(FLOW_ID);
  });

  it("drops post scoping and the public reply from the DM row", () => {
    const rows = buildDesiredTriggers(
      [
        triggerNode({
          triggerType: "comment_keyword",
          alsoMatchInDms: true,
          keywords: [{ value: "focus", matchType: "contains" }],
          postIds: ["post-1"],
          replyText: "check your DMs",
        }),
      ],
      FLOW_ID,
    );

    expect(rows[0].config).toMatchObject({ postIds: ["post-1"], replyText: "check your DMs" });
    expect(rows[1].config).not.toHaveProperty("postIds");
    expect(rows[1].config).not.toHaveProperty("replyText");
  });

  it("does not emit a DM row without keywords, which would match every message", () => {
    const rows = buildDesiredTriggers(
      [triggerNode({ triggerType: "comment_keyword", alsoMatchInDms: true, keywords: [] })],
      FLOW_ID,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("comment_keyword");
  });

  it("ignores the flag on trigger types that are not comment_keyword", () => {
    const rows = buildDesiredTriggers(
      [triggerNode({ triggerType: "keyword", alsoMatchInDms: true, keywords: [{ value: "focus", matchType: "exact" }] })],
      FLOW_ID,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("keyword");
  });

  it("skips non-trigger nodes and unknown trigger types", () => {
    const rows = buildDesiredTriggers(
      [
        { id: "n2", type: "sendMessage", data: {} },
        triggerNode({ triggerType: "not_a_real_type" }),
      ],
      FLOW_ID,
    );

    expect(rows).toEqual([]);
  });

  it("carries payload triggers and priority through unchanged", () => {
    const rows = buildDesiredTriggers(
      [triggerNode({ triggerType: "postback", payload: "GET_STARTED", config: { priority: 5 } })],
      FLOW_ID,
    );

    expect(rows[0]).toMatchObject({ type: "postback", priority: 5, config: { payload: "GET_STARTED" } });
  });
});

describe("los tipos que no son de mensaje (arreglo colateral de la Etapa 4)", () => {
  it("un trigger de contacto nuevo ahora SÍ se guarda", () => {
    // Antes la lista de tipos guardables estaba escrita a mano con los seis de
    // mensaje: el editor ofrecía "Contacto nuevo" y al publicar no se escribía
    // ninguna fila, así que el flow no arrancaba nunca.
    const rows = buildDesiredTriggers([{ type: "trigger", data: { triggerType: "new_contact" } }], "flow-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("new_contact");
  });

  it("un evento del CRM guarda su evento y su valor", () => {
    const rows = buildDesiredTriggers(
      [{ type: "trigger", data: { triggerType: "crm_event", event: "tag_added", value: "interesado" } }],
      "flow-1",
    );
    expect(rows[0].config).toMatchObject({ event: "tag_added", value: "interesado" });
  });

  it("un trigger de agenda guarda sus filtros y su desfase", () => {
    const rows = buildDesiredTriggers(
      [{ type: "trigger", data: { triggerType: "booking_before_start", offset_minutes: 1440, origins: ["public_page"], label: "Recordatorio" } }],
      "flow-1",
    );
    expect(rows[0].type).toBe("booking_before_start");
    expect(rows[0].config).toMatchObject({ offset_minutes: 1440, origins: ["public_page"] });
    // La etiqueta es del canvas, no del trigger.
    expect(rows[0].config).not.toHaveProperty("label");
  });

  it("un filtro vacío no se guarda: vacío quiere decir 'cualquiera'", () => {
    const rows = buildDesiredTriggers(
      [{ type: "trigger", data: { triggerType: "booking_created", origins: [], host_user_ids: [] } }],
      "flow-1",
    );
    expect(rows[0].config).toEqual({});
  });

  it("un tipo que el registro no conoce se sigue descartando", () => {
    expect(buildDesiredTriggers([{ type: "trigger", data: { triggerType: "inventado" } }], "flow-1")).toEqual([]);
  });
});
