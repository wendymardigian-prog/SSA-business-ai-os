import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { callJobKey, enqueueCallJob, enqueueClassify } from "./queue";

describe("enqueueCallJob", () => {
  it("encola con la clave <tipo>:<callId> y el callId en el payload", async () => {
    const db = fakeDb({ "scheduled_jobs:insert": { data: { id: "j" } } });
    const at = new Date("2026-10-10T18:00:00Z");
    expect(await enqueueCallJob(db.client, "call_analyze", "c1", at, { regenerate: true })).toEqual({ queued: true });
    expect(db.writesTo("scheduled_jobs")[0].values).toMatchObject({ type: "call_analyze", payload: { callId: "c1", regenerate: true }, dedupe_key: "call_analyze:c1", run_at: at.toISOString() });
  });
  it("un duplicado pendiente (23505) no es un error", async () => {
    const db = fakeDb({ "scheduled_jobs:insert": { error: { message: "dup", code: "23505" } } });
    expect(await enqueueCallJob(db.client, "call_classify", "c1")).toEqual({ queued: false });
  });
  it("otro error si lanza", async () => {
    const db = fakeDb({ "scheduled_jobs:insert": { error: { message: "caida", code: "XX000" } } });
    await expect(enqueueCallJob(db.client, "call_classify", "c1")).rejects.toBeTruthy();
  });
  it("la clave y el atajo de clasificar", async () => {
    expect(callJobKey("call_summary", "c9")).toBe("call_summary:c9");
    const db = fakeDb({ "scheduled_jobs:insert": { data: { id: "j" } } });
    await enqueueClassify(db.client, "c1");
    expect(db.writesTo("scheduled_jobs")[0].values).toMatchObject({ type: "call_classify", dedupe_key: "call_classify:c1" });
  });
});
