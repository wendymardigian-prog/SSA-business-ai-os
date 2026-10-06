import { describe, expect, it } from "vitest";
import {
  copyJustFinished,
  datesSummary,
  draftFromPost,
  draftPayload,
  shouldPollCopy,
  isEditableStatus,
  pieceButtons,
  publicationsVisible,
  statusChangeAction,
  statusOptions,
} from "./piece-drawer";
import type { ContentPermissions } from "./status";

const admin: ContentPermissions = { create: true, approve: true, publish: true, isAuthor: false };
const authorMember: ContentPermissions = { create: true, approve: false, publish: false, isAuthor: true };
const otherMember: ContentPermissions = { create: true, approve: false, publish: false, isAuthor: false };

describe("el estado es un dropdown con lo que se puede elegir (F96)", () => {
  const byValue = (opts: ReturnType<typeof statusOptions>) => Object.fromEntries(opts.map((o) => [o.value, o]));

  it("un admin en Borrador puede ir a Produccion y Revision; Aprobado no (primero hay que revisarla)", () => {
    const o = byValue(statusOptions(admin, "draft"));

    expect(o.draft.disabled).toBe(false);
    expect(o.in_production.disabled).toBe(false);
    expect(o.in_review.disabled).toBe(false);
    expect(o.approved.disabled).toBe(true);
    expect(o.approved.reason).toContain("revision");
  });

  it("en Revision, un admin puede aprobar", () => {
    expect(byValue(statusOptions(admin, "in_review")).approved.disabled).toBe(false);
  });

  it("un Member autor mueve lo suyo entre borrador, produccion y revision, y no aprueba", () => {
    const o = byValue(statusOptions(authorMember, "draft"));

    expect(o.in_production.disabled).toBe(false);
    expect(o.in_review.disabled).toBe(false);
    expect(o.approved.disabled).toBe(true);
  });

  it("un Member que NO es el autor no mueve nada, y dice por que", () => {
    const o = byValue(statusOptions(otherMember, "draft"));

    expect(o.in_production.disabled).toBe(true);
    expect(o.in_production.reason).toContain("autor");
  });

  it("'Programado' no se elige desde el dropdown: se programa con fecha, desde el pie", () => {
    expect(statusOptions(admin, "approved").some((o) => o.value === "scheduled" && !o.disabled)).toBe(false);
  });

  it("un estado derivado (publicado) se muestra, pero el dropdown no ofrece moverlo", () => {
    const opts = statusOptions(admin, "published");
    const current = opts.find((o) => o.value === "published");

    expect(current).toBeTruthy();
    // Una pieza publicada no vuelve atras (se archiva).
    expect(opts.filter((o) => o.value !== "published" && o.value !== "approved").every((o) => o.disabled)).toBe(true);
  });

  it("el estado actual siempre esta en la lista y habilitado", () => {
    for (const status of ["draft", "in_production", "in_review", "approved", "scheduled", "failed"] as const) {
      const current = statusOptions(admin, status).find((o) => o.value === status);
      expect(current?.disabled).toBe(false);
    }
  });
});

describe("que hace cada cambio del dropdown", () => {
  it("a Revision se manda por requestReview (que avisa a quien revisa)", () => {
    expect(statusChangeAction("draft", "in_review")).toBe("request_review");
    expect(statusChangeAction("in_production", "in_review")).toBe("request_review");
  });

  it("a Aprobado, por approvePost", () => {
    expect(statusChangeAction("in_review", "approved")).toBe("approve");
  });

  it("de Revision a atras es DEVOLVER: pide el motivo", () => {
    expect(statusChangeAction("in_review", "draft")).toBe("return");
    expect(statusChangeAction("in_review", "in_production")).toBe("return");
  });

  it("el resto es un movimiento simple", () => {
    expect(statusChangeAction("draft", "in_production")).toBe("move");
    expect(statusChangeAction("in_production", "draft")).toBe("move");
    expect(statusChangeAction("approved", "draft")).toBe("move");
  });

  it("no cambiar de estado no es una accion", () => {
    expect(statusChangeAction("draft", "draft")).toBeNull();
  });
});

describe("el pie: 'N de M redes con fecha' (F96)", () => {
  it("cuenta las que tienen fecha", () => {
    expect(datesSummary(3, 2)).toBe("2 de 3 redes con fecha");
    expect(datesSummary(1, 1)).toBe("1 de 1 red con fecha");
    expect(datesSummary(2, 0)).toBe("0 de 2 redes con fecha");
  });

  it("sin redes lo dice distinto: no hay nada que contar", () => {
    expect(datesSummary(0, 0)).toBe("Todavía no elegiste ninguna red");
  });
});

describe("que se puede editar", () => {
  it("solo Borrador, Produccion y Revision", () => {
    expect(isEditableStatus("draft")).toBe(true);
    expect(isEditableStatus("in_production")).toBe(true);
    expect(isEditableStatus("in_review")).toBe(true);
    expect(isEditableStatus("approved")).toBe(false);
    expect(isEditableStatus("published")).toBe(false);
  });
});

describe("la seccion de estado por red", () => {
  it("aparece cuando alguna red tiene publicacion viva", () => {
    expect(publicationsVisible([{ status: "scheduled" }])).toBe(true);
    expect(publicationsVisible([{ status: "failed" }, { status: "published" }])).toBe(true);
  });

  it("no aparece sin publicaciones, ni con solo canceladas o sin estado", () => {
    expect(publicationsVisible([])).toBe(false);
    expect(publicationsVisible([{ status: "cancelled" }])).toBe(false);
    expect(publicationsVisible([{ status: null }])).toBe(false);
  });
});

describe("los botones del pie, segun permiso y estado (F96)", () => {
  const base = { hasDates: true, aiAvailable: true, schedulable: 2, publications: [] as Array<{ status: string | null }> };
  const actions = (over: Partial<Parameters<typeof pieceButtons>[0]>) =>
    pieceButtons({ status: "draft", perms: { ...admin, ai: true }, ...base, ...over }).map((b) => b.action);

  it("un admin con IA en Borrador ve Generar, Guardar version y Enviar a revision", () => {
    expect(actions({})).toEqual(expect.arrayContaining(["generate_copy", "save_version", "send_to_review"]));
  });

  it("un Member NO ve Programar ni Publicar ahora: no estan, no es que esten apagados", () => {
    const a = actions({ perms: { ...authorMember, ai: false } });

    expect(a).not.toContain("schedule");
    expect(a).not.toContain("publish_now");
    expect(a).not.toContain("generate_copy");
    expect(a).toContain("send_to_review");
  });

  it("aprobada: se puede Programar", () => {
    expect(actions({ status: "approved" })).toContain("schedule");
  });

  it("con redes que fallaron y permiso de publicar, ofrece reintentar", () => {
    expect(actions({ status: "partially_published", publications: [{ status: "failed" }, { status: "published" }] })).toContain(
      "retry_all",
    );
  });

  it("reintentar no aparece si nada fallo, ni para quien no publica", () => {
    expect(actions({ status: "published", publications: [{ status: "published" }] })).not.toContain("retry_all");
    expect(
      actions({
        status: "failed",
        perms: { ...authorMember, ai: false },
        publications: [{ status: "failed" }],
      }),
    ).not.toContain("retry_all");
  });

  it("en Revision, quien aprueba ve Aprobar y Devolver", () => {
    expect(actions({ status: "in_review" })).toEqual(expect.arrayContaining(["approve", "return_to_draft"]));
  });

  it("Archivar no aparece en una pieza ya publicada", () => {
    expect(actions({ status: "published" })).not.toContain("archive");
  });
});

describe("el borrador del drawer", () => {
  const post = {
    title: "Una pieza",
    script: "Guion",
    recordingNotes: null,
    format: "Reel",
    pillarId: "p1",
    offerId: null,
    funnelStage: "mofu",
    reference: null,
    caption: null,
    networks: [{ platform: "instagram" }],
  };

  it("lo guardado pasa al borrador, y lo que no hay queda como texto vacio (un input no acepta null)", () => {
    expect(draftFromPost(post)).toEqual({
      title: "Una pieza",
      script: "Guion",
      recording_notes: "",
      format: "Reel",
      pillarId: "p1",
      offerId: "",
      funnelStage: "mofu",
      reference: "",
      caption: "",
      networks: [{ platform: "instagram" }],
    });
  });

  it("al guardar, lo vacio viaja como null y el formato y la referencia se recortan", () => {
    const payload = draftPayload("post-1", {
      ...draftFromPost(post),
      format: "  Reel  ",
      reference: "   ",
      offerId: "",
    });

    expect(payload).toMatchObject({
      postId: "post-1",
      format: "Reel",
      reference: null,
      offer_id: null,
      pillar_id: "p1",
      funnel_stage: "mofu",
      script: "Guion",
    });
  });

  it("ida y vuelta: lo que se guarda es lo que se lee", () => {
    const draft = draftFromPost(post);
    const payload = draftPayload("post-1", draft);

    expect(payload.title).toBe(draft.title);
    expect(payload.script).toBe(draft.script);
    expect(payload.networks).toEqual(draft.networks);
  });
});

describe("el copywriter escribiendo", () => {
  it("se vuelve a preguntar solo mientras escribe", () => {
    expect(shouldPollCopy("generating")).toBe(true);
    expect(shouldPollCopy("idle")).toBe(false);
    expect(shouldPollCopy("failed")).toBe(false);
  });

  it("al terminar (bien o mal) hay que releer el texto guardado", () => {
    expect(copyJustFinished("generating", "idle")).toBe(true);
    expect(copyJustFinished("generating", "failed")).toBe(true);
  });

  it("mientras sigue escribiendo, o si no estaba escribiendo, no", () => {
    expect(copyJustFinished("generating", "generating")).toBe(false);
    expect(copyJustFinished("idle", "idle")).toBe(false);
    expect(copyJustFinished("idle", "generating")).toBe(false);
  });
});
