import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachmentLabel, type AttachmentKind } from "@/lib/messages/attachments";

/**
 * Las etiquetas del preview en SQL (00262, `private.attachment_preview_label`)
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

describe("00262: etiquetas de adjuntos SQL = TS", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/00262_conversation_last_message.sql"), "utf8");
  const labels = new Map([...sql.matchAll(/WHEN '([a-z_]+)' THEN '([^']+)'/g)].map((m) => [m[1], m[2]]));

  it.each(KINDS)("%s", (kind) => {
    expect(labels.get(kind)).toBe(attachmentLabel(kind));
  });

  it("lo desconocido dice lo mismo que 'unsupported'", () => {
    expect(sql).toContain(`ELSE '${attachmentLabel("unsupported")}'`);
  });
});
