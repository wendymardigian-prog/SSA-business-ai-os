/**
 * Una sola guardia de entrega (00287). Falla si:
 *  - el tope viejo del nodo «Enviar email» (100 por dia, contado sobre `email_log` en dia UTC) vuelve;
 *  - alguno de los dos emisores deja de reservar el lugar de un email de marketing antes de mandarlo.
 * El tope de marketing se decide en UN lugar (`reserve_email_send` / `decideEmailSend`): no conviven dos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("una sola guardia de entrega", () => {
  it("el nodo «Enviar email» no tiene tope propio", () => {
    const src = read("lib/flow-engine/nodes/send-email.ts");
    expect(src).not.toMatch(/computeQuota\s*\(/);
    expect(src).not.toMatch(/from\(\s*["']email_log["']\s*\)/);
    expect(src).not.toMatch(/email_quota_reached/);
  });

  it("los dos emisores reservan el lugar de un email de marketing antes de mandar", () => {
    for (const file of ["lib/email/send.ts", "lib/email/send-reply.ts"]) {
      const src = read(file);
      const reserve = src.indexOf("reserveEmailSend(");
      const send = src.indexOf("sendViaResend(", src.indexOf("export async function"));
      expect(reserve, `${file} reserva`).toBeGreaterThan(-1);
      expect(reserve, `${file} reserva ANTES de mandar`).toBeLessThan(send);
      expect(src, `${file} reserva solo marketing`).toMatch(/category === "marketing"\) \{\s*const reserved = await reserveEmailSend/);
    }
  });

  it("nadie mas cuenta los emails del dia para frenar", () => {
    const callers = ["lib/send-queue/dispatch.ts", "lib/sequences/processor.ts", "lib/flow-engine/nodes/send-message.ts", "lib/flow-engine/nodes/send-asset.ts"];
    for (const file of callers) expect(read(file), file).not.toMatch(/computeQuota\s*\(/);
  });
});
