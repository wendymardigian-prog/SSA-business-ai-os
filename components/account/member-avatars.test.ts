import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "@/components/ui/filter-menu";
import { MemberAvatarsProvider } from "./member-avatars";
import { MemberCircle } from "./user-avatar";

/**
 * Las fotos del equipo (Mi cuenta, 00273). Lo que importa: un `Avatar` sin
 * foto se ve EXACTAMENTE como antes de esta tanda.
 */

const BEFORE =
  '<span class="grid shrink-0 place-items-center rounded-full font-bold text-white h-[22px] w-[22px] text-[10px]" style="background-color:#2563eb" aria-hidden="true">AB</span>';

describe("Avatar", () => {
  it("sin userId, el mismo HTML de siempre", () => {
    expect(renderToStaticMarkup(createElement(Avatar, { initials: "AB", color: "#2563eb" }))).toBe(BEFORE);
  });

  it("con userId pero sin foto (o sin proveedor), tambien igual", () => {
    expect(renderToStaticMarkup(createElement(Avatar, { initials: "AB", color: "#2563eb", userId: "u1" }))).toBe(BEFORE);
    const html = renderToStaticMarkup(
      createElement(MemberAvatarsProvider, { avatars: { u2: "https://x/y.jpg" } }, createElement(Avatar, { initials: "AB", color: "#2563eb", userId: "u1" })),
    );
    expect(html).toBe(BEFORE);
  });

  it("con foto, la foto", () => {
    const html = renderToStaticMarkup(
      createElement(MemberAvatarsProvider, { avatars: { u1: "https://x/y.jpg" } }, createElement(Avatar, { initials: "AB", color: "#2563eb", userId: "u1" })),
    );
    expect(html).toContain('<img src="https://x/y.jpg"');
    expect(html).not.toContain(">AB<");
  });
});

describe("MemberCircle", () => {
  it("sin foto, las iniciales del nombre", () => {
    const html = renderToStaticMarkup(createElement(MemberCircle, { userId: "u1", name: "Ana Pérez" }));
    expect(html).toContain(">AP<");
  });
  it("con foto, la foto", () => {
    const html = renderToStaticMarkup(
      createElement(MemberAvatarsProvider, { avatars: { u1: "https://x/a.jpg" } }, createElement(MemberCircle, { userId: "u1", name: "Ana" })),
    );
    expect(html).toContain('src="https://x/a.jpg"');
  });
});
