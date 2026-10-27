import { lastFunctionDefinition } from "@/lib/test-utils/migrations";
import { describe, expect, it } from "vitest";
import { attachmentLabel, type AttachmentKind } from "@/lib/messages/attachments";

/**
 * Las etiquetas del preview en SQL (`private.attachment_preview_label`)
 * tienen que ser las mismas que las de TypeScript: el trigger escribe el preview
 * de cualquier mensaje y los caminos de TS lo vuelven a escribir para los suyos.
 */
const KINDS: AttachmentKind[] = [
  "image",
  "video",
  "audio",
  "voice",
  "sticker",
  "gif",
  "document",
  "location",
  "contact",
  "poll",
  "share",
  "link",
  "story_reply",
];

describe("etiquetas de adjuntos SQL = TS", () => {
  const sql = lastFunctionDefinition("private.attachment_preview_label")?.sql ?? "";
  const labels = new Map([...sql.matchAll(/WHEN '([a-z_]+)' THEN '([^']+)'/g)].map((m) => [m[1], m[2]]));

  it.each(KINDS)("%s", (kind) => {
    expect(labels.get(kind)).toBe(attachmentLabel(kind));
  });

  it("lo desconocido dice lo mismo que 'unsupported'", () => {
    expect(sql).toContain(`ELSE '${attachmentLabel("unsupported")}'`);
  });
});
