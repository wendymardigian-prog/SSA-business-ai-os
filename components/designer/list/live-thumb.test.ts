import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyDoc } from "@/lib/designer/doc/schema";
import { qaBadge } from "@/lib/designer/screens/thumbs";
import { LiveThumb } from "./live-thumb";

const doc = emptyDoc("v45");

describe("components/designer/list: el punto ámbar de la miniatura (F36)", () => {
  it("con algo para mirar dibuja el punto con su texto; sin nada, la miniatura queda igual que antes", () => {
    const qa = qaBadge({ issues: [{ kind: "contrast", page: 0 }] }, 0);
    const withDot = renderToString(createElement(LiveThumb, { doc, box: { width: 100, height: 100 }, label: "Pieza", qa }));
    expect(withDot).toContain('aria-label="Revisión automática: hay algo para mirar"');
    expect(withDot).toContain('title="Revisión automática: hay algo para mirar"');
    expect(withDot).toContain("bg-warn");

    const plain = renderToString(createElement(LiveThumb, { doc, box: { width: 100, height: 100 }, label: "Pieza" }));
    expect(plain).not.toContain("Revisión automática");
    expect(plain).toBe(renderToString(createElement(LiveThumb, { doc, box: { width: 100, height: 100 }, label: "Pieza", qa: null })));
  });
});
