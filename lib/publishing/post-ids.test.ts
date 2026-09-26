/**
 * Completar el postId de la automatizacion al publicar (F39).
 */

import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import type { AutomationRule } from "@/lib/content/keywords";
import { completePostIds, planPostId } from "./post-ids";

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  triggerId: "t1",
  flowId: "f1",
  flowName: "Guia",
  type: "comment_keyword",
  isActive: true,
  channelIds: [],
  keywords: [{ value: "SISTEMA", matchType: "contains" }],
  postIds: ["ig-viejo"],
  ...over,
});

const base = {
  cta: { type: "comment" as const, keyword: "SISTEMA" },
  platform: "instagram",
  channelId: null,
  externalPostId: "ig-9",
};

describe("a que automatizacion se le completa el id (F39)", () => {
  it("a la que esta limitada a posts y responde esa palabra", () => {
    expect(planPostId({ ...base, rules: [rule()] })).toEqual({
      triggerId: "t1",
      postIds: ["ig-viejo", "ig-9"],
    });
  });

  it("una que responde a todos los posts no se toca", () => {
    // Agregarle el id la limitaria a este, que es lo contrario de lo
    // configurado: dejaria de responder en todos los demas.
    expect(planPostId({ ...base, rules: [rule({ postIds: [] })] })).toBeNull();
  });

  it("no duplica el id si ya estaba", () => {
    expect(planPostId({ ...base, rules: [rule({ postIds: ["ig-9"] })] })).toBeNull();
  });

  it("una automatizacion apagada no cuenta", () => {
    expect(planPostId({ ...base, rules: [rule({ isActive: false })] })).toBeNull();
  });

  it("sin id de la red no hay nada que completar", () => {
    expect(planPostId({ ...base, externalPostId: null, rules: [rule()] })).toBeNull();
  });

  it("sin CTA tampoco", () => {
    expect(planPostId({ ...base, cta: null, rules: [rule()] })).toBeNull();
  });

  it("un CTA de DM busca la automatizacion de mensajes, no la de comentarios", () => {
    expect(
      planPostId({ ...base, cta: { type: "dm", keyword: "SISTEMA" }, rules: [rule()] }),
    ).toBeNull();
  });
});

describe("escribirlo (F39)", () => {
  const db = () =>
    memoryDb(
      {
        triggers: [
          {
            id: "t1",
            workspace_id: "ws-1",
            flow_id: "f1",
            type: "comment_keyword",
            is_active: true,
            channel_id: null,
            config: { keywords: [{ value: "SISTEMA" }], postIds: ["ig-viejo"] },
          },
        ],
        flows: [{ id: "f1", name: "Guia" }],
      },
      { joins: { "triggers.flows": () => ({ name: "Guia" }) } },
    );

  it("deja el id nuevo sin perder los anteriores", async () => {
    const memory = db();

    const done = await completePostIds(memory.client, {
      workspaceId: "ws-1",
      platform: "instagram",
      channelId: null,
      cta: { type: "comment", keyword: "SISTEMA" },
      externalPostId: "ig-9",
    });

    expect(done).toBe(true);
    expect((memory.rows("triggers")[0].config as { postIds: string[] }).postIds).toEqual([
      "ig-viejo",
      "ig-9",
    ]);
  });

  it("si no hay a quien completarle, no escribe nada", async () => {
    const memory = db();

    const done = await completePostIds(memory.client, {
      workspaceId: "ws-1",
      platform: "instagram",
      channelId: null,
      cta: { type: "comment", keyword: "OTRA" },
      externalPostId: "ig-9",
    });

    expect(done).toBe(false);
    expect((memory.rows("triggers")[0].config as { postIds: string[] }).postIds).toEqual(["ig-viejo"]);
  });
});
