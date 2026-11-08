import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPermissionAction, createServiceClient, revalidatePath, requests } = vi.hoisted(() => ({
  getPermissionAction: vi.fn(),
  createServiceClient: vi.fn(async () => ({ servicio: true })),
  revalidatePath: vi.fn(),
  requests: {
    addGoogleFontRequest: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { family: "Lobster" } })),
    archiveStyleRequest: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: undefined })),
    extractStyleRequest: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { style: { key: "c_abc123" }, corrections: ["x"] } })),
    removeFontRequest: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: undefined })),
    saveStyleRequest: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { style: { key: "c_abc123" } } })),
    uploadFontRequest: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { family: "Mi Fuente", weight: 700 } })),
  },
}));

vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: (key: string) => getPermissionAction(key) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => createServiceClient() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/designer/settings-requests", () => requests);

import { addGoogleFont, archiveStyle, extractStyle, removeFont, saveStyle, uploadFont } from "./settings";

const session = { workspace: { id: "ws-de-la-sesion" }, user: { id: "user-de-la-sesion" } };
const style = { key: "c_abc123", name: "Mi estilo", palette: { bg: "#000000", text: "#ffffff", accent: "#ff0000" }, fonts: { title: "Inter", body: "Inter" }, density: {}, rules: "" };

beforeEach(() => {
  vi.clearAllMocks();
  getPermissionAction.mockResolvedValue(session);
});

describe("acciones de Ajustes del Diseñador IA", () => {
  it("sin designer.manage responden «No tenés permiso» y no tocan nada", async () => {
    getPermissionAction.mockResolvedValue(null);
    const expected = { ok: false, error: "No tenés permiso para hacer esto." };
    expect(await saveStyle({ style })).toEqual(expected);
    expect(await archiveStyle({ key: "c_abc123" })).toEqual(expected);
    expect(await addGoogleFont({ family: "Lobster" })).toEqual(expected);
    expect(await removeFont({ family: "Lobster" })).toEqual(expected);
    expect(await uploadFont(new FormData())).toEqual(expected);
    expect(await extractStyle(new FormData())).toEqual(expected);
    for (const fn of Object.values(requests)) expect(fn).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(new Set(getPermissionAction.mock.calls.map((c) => c[0]))).toEqual(new Set(["designer.manage"]));
  });

  it("el negocio y la persona salen de la sesión, no del navegador", async () => {
    await saveStyle({ style, workspaceId: "otro" } as never);
    await addGoogleFont({ family: "Lobster", workspaceId: "otro" } as never);
    await archiveStyle({ key: "c_abc123" });
    await removeFont({ family: "Lobster", path: "ws/fonts/a.woff2" });
    for (const fn of [requests.saveStyleRequest, requests.addGoogleFontRequest, requests.archiveStyleRequest, requests.removeFontRequest]) {
      expect(fn).toHaveBeenCalledWith({ servicio: true }, { workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion" }, expect.anything());
    }
    expect(JSON.stringify(requests.saveStyleRequest.mock.calls)).not.toContain("otro");
  });

  it("subir una fuente lee el archivo y los campos del formulario", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], "Mi-Fuente.woff2"));
    form.append("family", "Mi Fuente");
    form.append("weight", "700");
    form.append("italic", "true");
    expect(await uploadFont(form)).toEqual({ ok: true, data: { family: "Mi Fuente", weight: 700 } });
    expect(requests.uploadFontRequest).toHaveBeenCalledWith(
      { servicio: true },
      expect.objectContaining({ workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion", fileName: "Mi-Fuente.woff2", family: "Mi Fuente", weight: 700, italic: true, bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32]) }),
    );
    expect(await uploadFont(new FormData())).toEqual({ ok: false, error: "Elegí un archivo de fuente." });
  });

  it("extraer un estilo lee las imágenes y los diseños elegidos, y devuelve el estilo con los avisos", async () => {
    const form = new FormData();
    for (let i = 0; i < 3; i++) form.append("images", new File([new Uint8Array([1, 2, 3])], `p${i}.png`));
    form.append("designIds", "d1");
    form.append("name", "Mi estilo");
    const r = await extractStyle(form);
    expect(r).toEqual({ ok: true, data: { style: { key: "c_abc123" }, corrections: ["x"] } });
    const call = requests.extractStyleRequest.mock.calls[0] as unknown[];
    expect(call[1]).toMatchObject({ workspaceId: "ws-de-la-sesion", designIds: ["d1"], name: "Mi estilo" });
    expect((call[1] as { files: unknown[] }).files).toHaveLength(3);
  });

  it("una imagen de más de 8 MB se rechaza antes de leerla", async () => {
    const form = new FormData();
    form.append("images", new File([new Uint8Array(8 * 1024 * 1024 + 1)], "enorme.png"));
    const r = await extractStyle(form);
    expect(r).toEqual({ ok: false, error: "«enorme.png» pesa más de 8 MB." });
    expect(requests.extractStyleRequest).not.toHaveBeenCalled();
  });

  it("refresca la pantalla de ajustes cuando algo cambia, no cuando solo se analiza", async () => {
    await saveStyle({ style });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/disenos/ajustes");
    revalidatePath.mockClear();
    await extractStyle(new FormData());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un imprevisto no lanza hacia la pantalla", async () => {
    requests.saveStyleRequest.mockRejectedValueOnce(new Error("la base se cayó"));
    expect(await saveStyle({ style })).toEqual({ ok: false, error: "No pude hacerlo ahora. Probá de nuevo." });
  });
});
