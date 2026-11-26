import { describe, expect, it } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tip } from "./tooltip";

/**
 * `Tip asChild` nunca tumba la pantalla (24/11/2026). Un hijo que llega desde un componente de servidor puede ser un
 * lazy de React (el payload RSC lo manda en otra tanda) y `Children.only` lo rechazaba: la ficha del cliente no abría.
 */
function lazyOf(node: ReactNode): ReactNode {
  return { $$typeof: Symbol.for("react.lazy"), _payload: node, _init: (p: ReactNode) => p } as unknown as ReactNode;
}

function tip(...children: ReactNode[]): string {
  return renderToStaticMarkup(h(Tip, { asChild: true, content: "Ayuda", children: children.length === 1 ? children[0] : children }));
}

describe("Tip asChild", () => {
  it("con un elemento, lo dibuja sin envoltorio", () => {
    const html = tip(h("button", { type: "button", "aria-label": "Variación" }, "▲ 14 %"));
    expect(html).toContain('aria-label="Variación"');
    expect(html.startsWith("<button")).toBe(true);
  });

  it("con un hijo lazy (llega desde el servidor), lo desenvuelve y no lanza", () => {
    const html = tip(lazyOf(h("button", { type: "button", "aria-label": "Leads" }, "▲ nuevo")));
    expect(html).toContain('aria-label="Leads"');
    expect(html).toContain("▲ nuevo");
  });

  it("con dos hijos, los dibuja sin tooltip y no lanza", () => {
    const html = tip(h("span", { key: "a" }, "uno"), h("span", { key: "b" }, "dos"));
    expect(html).toContain("uno");
    expect(html).toContain("dos");
  });

  it("sin hijos o con texto suelto, no lanza", () => {
    expect(() => tip(null)).not.toThrow();
    expect(tip("texto")).toBe("texto");
  });
});
