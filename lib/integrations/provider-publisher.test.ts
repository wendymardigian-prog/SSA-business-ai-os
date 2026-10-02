import { describe, it, expect } from "vitest";
import { publisherIdFor } from "./provider-publisher";

describe("publisherIdFor (G7)", () => {
  it("mapea las cinco cards de publicacion a su publicador", () => {
    expect(publisherIdFor("zernio")).toBe("zernio");
    expect(publisherIdFor("postproxy")).toBe("postproxy");
    expect(publisherIdFor("google")).toBe("youtube_api");
    expect(publisherIdFor("linkedin")).toBe("linkedin_api");
    expect(publisherIdFor("threads")).toBe("threads_api");
  });

  it("una integracion que no publica no tiene publicador", () => {
    expect(publisherIdFor("meta")).toBeNull();
    expect(publisherIdFor("resend")).toBeNull();
    expect(publisherIdFor("anthropic")).toBeNull();
    expect(publisherIdFor("evolution")).toBeNull();
  });
});
