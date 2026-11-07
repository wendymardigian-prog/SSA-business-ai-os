import { describe, it, expect } from "vitest";
import { matchCommentTrigger, shouldPostPublicReply, type CommentForMatching } from "./comment-processor";
import type { Database } from "@/lib/types/database";

type Trigger = Database["public"]["Tables"]["triggers"]["Row"];

function trigger(id: string, config: Record<string, unknown>): Trigger {
  return {
    id,
    flow_id: `flow-${id}`,
    channel_id: null,
    type: "comment_keyword",
    config,
    priority: 50,
    is_active: true,
    created_at: new Date().toISOString(),
  } as unknown as Trigger;
}

const comment = (text: string, postId = "post-1"): CommentForMatching => ({
  text,
  postId,
});

describe("matchCommentTrigger", () => {
  it("matches a contains keyword case-insensitively (default matchType)", () => {
    const t = trigger("t1", { keywords: [{ value: "Socrates" }] });
    expect(matchCommentTrigger([t], comment("love SOCRATES so much"))?.id).toBe("t1");
  });

  it("matches exact only on full trimmed text", () => {
    const t = trigger("t1", { keywords: [{ value: "price", matchType: "exact" }] });
    expect(matchCommentTrigger([t], comment("  PRICE "))?.id).toBe("t1");
    expect(matchCommentTrigger([t], comment("price please"))).toBeNull();
  });

  it("matches startsWith from the beginning only", () => {
    const t = trigger("t1", { keywords: [{ value: "info", matchType: "startsWith" }] });
    expect(matchCommentTrigger([t], comment("info please"))?.id).toBe("t1");
    expect(matchCommentTrigger([t], comment("more info"))).toBeNull();
  });

  it("returns the first matching trigger in array order (caller pre-sorts by priority)", () => {
    const low = trigger("low", { keywords: [{ value: "deal" }] });
    const high = trigger("high", { keywords: [{ value: "deal" }] });
    expect(matchCommentTrigger([high, low], comment("deal me in"))?.id).toBe("high");
  });

  it("respects postIds scoping", () => {
    const t = trigger("t1", { keywords: [{ value: "promo" }], postIds: ["post-9"] });
    expect(matchCommentTrigger([t], comment("promo", "post-1"))).toBeNull();
    expect(matchCommentTrigger([t], comment("promo", "post-9"))?.id).toBe("t1");
  });

  it("skips triggers without keywords and returns null when nothing matches", () => {
    const empty = trigger("t1", {});
    const other = trigger("t2", { keywords: [{ value: "xyz" }] });
    expect(matchCommentTrigger([empty, other], comment("hello world"))).toBeNull();
  });

  it("returns null for empty comment text", () => {
    const t = trigger("t1", { keywords: [{ value: "hi" }] });
    expect(matchCommentTrigger([t], comment("   "))).toBeNull();
  });
});

describe("la respuesta publica va despues del mensaje privado (6/11/2026)", () => {
  it("se publica si el privado salio, o si la automatizacion no intento ninguno", () => {
    expect(shouldPostPublicReply({ dmSent: true, privateReplyFailed: false, pending: false })).toBe(true);
    expect(shouldPostPublicReply({ dmSent: false, privateReplyFailed: false, pending: false })).toBe(true);
  });

  it("no se publica «Te envié por DM» si el privado fallo o quedo para reintentar", () => {
    expect(shouldPostPublicReply({ dmSent: false, privateReplyFailed: true, pending: false })).toBe(false);
    expect(shouldPostPublicReply({ dmSent: false, privateReplyFailed: false, pending: true })).toBe(false);
  });
});
