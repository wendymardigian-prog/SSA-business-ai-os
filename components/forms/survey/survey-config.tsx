"use client";

import { useState } from "react";
import { SurveyTab } from "@/components/forms/editor/survey-tab";
import type { ContactMode } from "@/lib/forms/contact-config";
import type { FormField } from "@/lib/forms/fields";
import type { SurveyConfig } from "@/lib/forms/survey";

/** La configuración de la encuesta, arriba de su panel (plano formularios-ui, diferencia 7). Guarda con su propio botón. */
export function SurveyConfigCards({
  formId,
  archived,
  contactMode,
  fields,
  initial,
  canManage,
}: {
  formId: string;
  archived: boolean;
  contactMode: ContactMode;
  fields: FormField[];
  initial: SurveyConfig | null;
  canManage: boolean;
}) {
  const [config, setConfig] = useState(initial);
  return <SurveyTab formId={formId} archived={archived} contactMode={contactMode} fields={fields} config={config} onSaved={setConfig} canManage={canManage} />;
}
