/**
 * La vista previa del editor (plano formularios-ui, F8). Puro: arma lo que el componente publico necesita
 * desde el borrador, y la pantalla final que se muestra al "enviar" sin mandar nada.
 */
import type { FormDesign } from "./defaults";
import type { FormDefinition, PublicFormType } from "./fields";
import type { PublicFormData } from "./public-client";
import { toPublicFields } from "./public-definition";
import { renderSuccess, validateSuccess, type RenderedSuccess, type SuccessConfig } from "./success";

/** Lo que `get_public_form` entregaria, pero armado desde el borrador: lo que el editor muestra es lo que se publicaria. */
export function buildPreviewData(input: {
  type: PublicFormType;
  slug: string;
  design: FormDesign;
  definition: FormDefinition;
  contract?: { title: string; acceptLabel: string; signatureRequired: boolean } | null;
}): PublicFormData {
  const { type, contract } = input;
  return {
    status: "available",
    slug: input.slug,
    type,
    version_id: "preview",
    design: input.design,
    fields: toPublicFields(input.definition.fields),
    contract:
      type === "contract" && contract
        ? { text: input.definition.contractText ?? "", version_number: 0, title: contract.title, accept_label: contract.acceptLabel }
        : null,
    signature_required: type === "contract" ? (contract?.signatureRequired ?? true) : false,
    survey: null,
  };
}

/**
 * La pantalla final de la vista previa. Un mensaje se ve como lo ve la persona (con las variables resueltas con lo
 * que se respondio en la prueba); una redireccion no se ejecuta: dice a donde llevaria.
 */
export function previewEnding(
  success: SuccessConfig | null | undefined,
  context: { formName: string; answers: Record<string, string> },
): RenderedSuccess {
  const parsed = validateSuccess(success ?? { mode: "message" });
  if (!parsed.ok) {
    // Mientras se escribe, la direccion puede estar a medias: se dice, no se rompe.
    return { mode: "message", title: "", body: `La pantalla final todavía no es válida: ${parsed.error}` };
  }
  if (parsed.success.mode === "redirect") {
    const url = parsed.success.url;
    const extra = parsed.success.passParams ? " Se le suman el id de la respuesta y los UTM." : "";
    return { mode: "message", title: "", body: `Acá la persona va a ${url}.${extra}` };
  }
  return renderSuccess(parsed.success, { formName: context.formName, answers: context.answers }, { escape: false });
}
