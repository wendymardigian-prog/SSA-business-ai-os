import { describe, it, expect } from "vitest";
import { buildContactFormRows, copyStatusLabel, responseHref, surveyText, totalLabel, viewAllFormsHref } from "./contact-forms";

const forms = [
  { id: "f-custom", name: "Aplicación", type: "custom" },
  { id: "f-survey", name: "¿Cómo te fue?", type: "survey" },
  { id: "f-contract", name: "Acuerdo de servicio", type: "contract" },
];

describe("buildContactFormRows", () => {
  const rows = buildContactFormRows({
    submissions: [
      { id: "s3", form_id: "f-contract", form_version_id: "v2", created_at: "2026-10-12T15:00:00Z", score: null, nps_category: null },
      { id: "s2", form_id: "f-survey", form_version_id: "v1", created_at: "2026-10-11T15:00:00Z", score: 4, nps_category: "detractor" },
      { id: "s1", form_id: "f-custom", form_version_id: "v1", created_at: "2026-10-10T15:00:00Z", score: null, nps_category: null },
    ],
    forms,
    versions: [{ id: "v2", version_number: 3 }],
    signatures: [{ submission_id: "s3", email_status: "retrying", pdf_status: "generated" }],
  });

  it("muestra las tres, de la más nueva a la más vieja, con su tipo y su fecha", () => {
    expect(rows.map((r) => r.id)).toEqual(["s3", "s2", "s1"]);
    expect(rows.map((r) => r.typeLabel)).toEqual(["Contrato", "Encuesta", "Personalizado"]);
    expect(rows[0].sentAt).toBe("2026-10-12T15:00:00Z");
  });

  it('una encuesta con NPS 4 dice "Detractor"', () => {
    expect(rows[1].surveyText).toBe("Puntaje 4 · Detractor");
    expect(rows[2].surveyText).toBeNull();
  });

  it("un contrato muestra la versión, el estado de la copia y si hay PDF", () => {
    expect(rows[0].contract).toEqual({ versionNumber: 3, copyStatus: "retrying", copyLabel: "Reintentando", canViewPdf: true });
    expect(rows[1].contract).toBeNull();
  });

  it("cada fila lleva al detalle de la respuesta", () => {
    expect(rows[0].href).toBe("/dashboard/formularios/f-contract/respuestas/s3");
    expect(responseHref("f", "s")).toBe("/dashboard/formularios/f/respuestas/s");
  });

  it("un contrato sin firma todavía (o con el PDF pendiente) no ofrece 'Ver PDF'", () => {
    const [row] = buildContactFormRows({
      submissions: [{ id: "s9", form_id: "f-contract", form_version_id: null, created_at: "2026-10-12T15:00:00Z", score: null, nps_category: null }],
      forms,
      versions: [],
      signatures: [{ submission_id: "s9", email_status: null, pdf_status: "pending" }],
    });
    expect(row.contract).toMatchObject({ versionNumber: null, copyLabel: "Pendiente", canViewPdf: false });
  });

  it("una respuesta de un formulario que quien mira no ve se omite", () => {
    expect(buildContactFormRows({ submissions: [{ id: "x", form_id: "otro", form_version_id: null, created_at: "2026-10-01T00:00:00Z", score: null, nps_category: null }], forms, versions: [], signatures: [] })).toEqual([]);
  });
});

describe("textos", () => {
  it("surveyText: con y sin categoría NPS", () => {
    expect(surveyText(10, "promoter")).toBe("Puntaje 10 · Promotor");
    expect(surveyText(7, "passive")).toBe("Puntaje 7 · Pasivo");
    expect(surveyText(4, null)).toBe("Puntaje 4");
    expect(surveyText(null, null)).toBeNull();
  });

  it("el estado de la copia: Enviada, Reintentando, No enviada", () => {
    expect(copyStatusLabel("sent")).toBe("Enviada");
    expect(copyStatusLabel("retrying")).toBe("Reintentando");
    expect(copyStatusLabel("not_sent")).toBe("No enviada");
    expect(copyStatusLabel(undefined)).toBe("Pendiente");
  });

  it("el total y el link de Ver todas", () => {
    expect(totalLabel(1)).toBe("1 formulario");
    expect(totalLabel(3)).toBe("3 formularios");
    expect(viewAllFormsHref("abc")).toBe("/dashboard/contacts/abc/formularios");
  });
});
