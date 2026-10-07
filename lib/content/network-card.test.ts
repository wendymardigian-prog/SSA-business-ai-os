import { describe, expect, it } from "vitest";
import { networkCardView, publisherLine } from "./network-card";
import type { NetworkStateView } from "./network-state";

const state = (id: NetworkStateView["id"], over: Partial<NetworkStateView> = {}): NetworkStateView => ({
  id,
  label: id,
  manual: false,
  at: null,
  ...over,
});

describe("C1 · red conectada y red no conectada", () => {
  it("no conectada: chip 'a mano' y sin programacion automatica, con el motivo a la vista", () => {
    const view = networkCardView({
      connected: false,
      canPublish: true,
      postStatus: "approved",
      state: state("tent"),
      auto: true,
    });
    expect(view.manualChip).toBe(true);
    // Aunque el dato diga auto, sin cuenta no hay nada que la publique.
    expect(view.mode).toBe("self");
    expect(view.systemDisabledReason).toBe("Conectá la cuenta en Integraciones para programar.");
  });

  it("conectada y aprobada: se puede elegir que la publique el sistema", () => {
    const view = networkCardView({
      connected: true,
      canPublish: true,
      postStatus: "approved",
      state: state("tent"),
      auto: false,
    });
    expect(view.manualChip).toBe(false);
    expect(view.mode).toBe("self");
    expect(view.systemDisabledReason).toBeNull();
  });

  it("conectada y programada: marcado 'el sistema la publica'", () => {
    const view = networkCardView({
      connected: true,
      canPublish: true,
      postStatus: "scheduled",
      state: state("sched"),
      auto: true,
    });
    expect(view.mode).toBe("system");
  });

  it("la planificacion no se bloquea: sin cuenta igual se puede marcar como publicada", () => {
    const view = networkCardView({
      connected: false,
      canPublish: true,
      postStatus: "draft",
      state: state("none"),
      auto: false,
    });
    expect(view.canMarkPublished).toBe(true);
  });
});

describe("C2 · por que no se puede programar", () => {
  it("una pieza sin aprobar no se programa sola", () => {
    const view = networkCardView({
      connected: true,
      canPublish: true,
      postStatus: "in_review",
      state: state("tent"),
      auto: false,
    });
    expect(view.systemDisabledReason).toBe("Se programa cuando la pieza esté aprobada.");
  });

  it("quien no publica no cambia el modo ni marca nada", () => {
    const view = networkCardView({
      connected: true,
      canPublish: false,
      postStatus: "approved",
      state: state("tent"),
      auto: false,
    });
    expect(view.systemDisabledReason).toBe("Programar es de quien puede publicar.");
    expect(view.selfDisabledReason).not.toBeNull();
    expect(view.canMarkPublished).toBe(false);
  });
});

describe("C3 · marcar y deshacer", () => {
  it("publicada por el sistema: no se marca ni se deshace a mano", () => {
    const view = networkCardView({
      connected: true,
      canPublish: true,
      postStatus: "published",
      state: state("pub"),
      auto: true,
    });
    expect(view.canMarkPublished).toBe(false);
    expect(view.canUndoManual).toBe(false);
  });

  it("publicada a mano: se puede deshacer", () => {
    const view = networkCardView({
      connected: false,
      canPublish: true,
      postStatus: "published",
      state: state("pub", { manual: true }),
      auto: false,
    });
    expect(view.canUndoManual).toBe(true);
  });
});

describe("C10 · la linea del publicador", () => {
  const labels = { postproxy: "Postproxy", youtube_api: "YouTube (API oficial)", zernio: "Zernio" };

  it("con un solo publicador no se muestra nada", () => {
    expect(publisherLine({ available: ["zernio"], current: "zernio", labels })).toBeNull();
  });

  it("YouTube con Postproxy y la API oficial: dice cual se usa", () => {
    expect(publisherLine({ available: ["postproxy", "youtube_api"], current: "postproxy", labels })).toBe("Postproxy");
  });

  it("sin publicador elegido no inventa uno", () => {
    expect(publisherLine({ available: ["postproxy", "youtube_api"], current: null, labels })).toBeNull();
  });
});
