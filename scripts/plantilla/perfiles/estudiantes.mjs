// Perfil de la plantilla de ESTUDIANTES: que modulos no viajan y que archivos son de cada uno.
//
// Un archivo (o carpeta) va en `paths` de un modulo solo si es SOLO de ese modulo: el
// export lo borra entero. Lo que comparten un modulo y el resto del sistema se queda, y
// lo del modulo adentro de ese archivo se saca con marcas (ver ../markers.mjs).
//
// `scripts/plantilla/modulos.test.ts` controla que, borrando todo esto y sacando lo
// marcado, ningun archivo que se queda importe algo que se va, y que cada ruta de esta
// lista exista (una lista vieja falla). `scripts/plantilla/simulate-export.mjs` es la
// prueba fuerte: arma la copia y corre el chequeo de tipos.
//
// Rutas relativas a la raiz del repo, con "/".

const D = "app/(dashboard)/dashboard";

export const MODULES = {
  llamadas: {
    label: "Llamadas (Fathom y el analizador de llamadas)",
    paths: [
      `${D}/llamadas`,
      `${D}/dashboards/llamadas`,
      "lib/calls",
      "lib/fathom",
      "components/calls",
      "components/dashboards/calls",
      "components/agents/tasks/calls",
      "components/contacts/calls-section.tsx",
      "components/settings/closer-control.tsx",
      "components/settings/integrations/fathom-app-card.tsx",
      "lib/actions/call-proposals.ts",
      "lib/actions/call-proposals.test.ts",
      "lib/actions/call-task-settings.ts",
      "lib/actions/call-task-settings.test.ts",
      "lib/actions/calls-edit.ts",
      "lib/actions/calls-edit.test.ts",
      "lib/actions/calls-import.ts",
      "lib/actions/calls-import.test.ts",
      "lib/actions/calls-link.ts",
      "lib/actions/calls-link.test.ts",
      "lib/actions/calls-objection.ts",
      "lib/actions/calls-objection.test.ts",
      "lib/actions/calls-test.ts",
      "lib/actions/calls-test.test.ts",
      "lib/actions/calls-use.ts",
      "lib/actions/calls-use.test.ts",
      "lib/actions/fathom.ts",
      "lib/actions/fathom.test.ts",
      "lib/dashboards/calls.ts",
      "lib/dashboards/calls.test.ts",
      "lib/dashboards/calls-load.ts",
      "lib/dashboards/calls-load.test.ts",
      "lib/jobs/handlers/call-analyze.ts",
      "lib/jobs/handlers/call-classify.ts",
      "lib/jobs/handlers/call-index-knowledge.ts",
      "lib/jobs/handlers/call-index-knowledge.test.ts",
      "lib/jobs/handlers/call-jobs.test.ts",
      "lib/jobs/handlers/call-summary.ts",
      "lib/jobs/handlers/call-summary.test.ts",
      "lib/jobs/handlers/fathom-sync.ts",
      "lib/jobs/handlers/fathom-sync.test.ts",
      "lib/flow-engine/registry/call-conditions.ts",
      "lib/flow-engine/registry/call-conditions.test.ts",
      "lib/flow-engine/registry/call-triggers.ts",
      "lib/flow-engine/registry/call-triggers.test.ts",
      "scripts/verify-calls.mjs",
    ],
  },
  formularios: {
    label: "Formularios (encuestas, fin de dia y contratos)",
    paths: [
      `${D}/formularios`,
      `${D}/eod`,
      `${D}/contacts/[contactId]/formularios`,
      "app/f",
      "app/api/public/forms",
      "app/api/v1/eod",
      "lib/forms",
      "lib/eod",
      "lib/actions/forms",
      "lib/actions/eod",
      "components/forms",
      "components/eod",
      "components/contacts/forms-section.tsx",
      "components/contacts/form-pdf-button.tsx",
      "components/flow-builder/panels/FormTriggerPanel.tsx",
      "lib/jobs/handlers/contract-email.ts",
      "lib/jobs/handlers/contract-email.test.ts",
      "lib/jobs/handlers/contract-pdf.ts",
      "lib/jobs/handlers/contract-pdf.test.ts",
      "lib/jobs/handlers/eod-reminder.ts",
      "lib/flow-engine/registry/form-triggers.ts",
      "lib/flow-engine/registry/eod-triggers.ts",
      "scripts/verify-forms.mjs",
      "scripts/verify-forms.impl.ts",
      "scripts/verify-eod.mjs",
      "scripts/verify-eod.impl.ts",
    ],
  },
  ventas: {
    label: "Ventas (ventas, pagos, cobranza y mora)",
    paths: [
      `${D}/ventas`,
      "lib/sales",
      "components/sales",
      "components/contacts/sales-section.tsx",
      "components/settings/sales-settings.tsx",
      "components/settings/payment-methods-card.tsx",
      "components/flow-builder/panels/SalesTriggerPanel.tsx",
      "lib/actions/sales.ts",
      "lib/actions/sales.test.ts",
      "lib/actions/sales-attribution.ts",
      "lib/actions/sales-attribution.test.ts",
      "lib/actions/sales-automation.ts",
      "lib/actions/sales-contract.ts",
      "lib/actions/sales-create.test.ts",
      "lib/actions/sales-settings.ts",
      "lib/actions/sales-settings.test.ts",
      "lib/actions/payments.ts",
      "lib/actions/payments.test.ts",
      "lib/jobs/handlers/payment-relative.ts",
      "lib/jobs/handlers/payments-overdue-sweep.ts",
      "lib/jobs/handlers/payments-overdue-sweep.test.ts",
      "lib/flow-engine/registry/sales-conditions.ts",
      "lib/flow-engine/registry/sales-triggers.ts",
      "lib/flow-engine/registry/sales-triggers.test.ts",
      "lib/flow-engine/nodes/sales-actions.ts",
      "lib/flow-engine/nodes/sales-actions.test.ts",
      "scripts/verify-sales.mjs",
      "scripts/verify-payment-methods.mjs",
    ],
  },
  tareas: {
    label: "Tareas",
    paths: [
      `${D}/tareas`,
      "lib/tasks",
      "components/tasks",
      "components/flow-builder/panels/TaskTriggerPanel.tsx",
      "components/flow-builder/panels/CreateTaskPanel.tsx",
      "components/flow-builder/panels/CompleteTaskPanel.tsx",
      "components/settings/payment-tasks-card.tsx",
      "components/scheduling/bookings/calendar-tasks.tsx",
      "components/scheduling/bookings/calendar-grid.tasks.test.ts",
      "lib/actions/tasks.ts",
      "lib/actions/tasks.test.ts",
      "lib/actions/task-settings.ts",
      "lib/agent/tools/create-task.ts",
      "lib/agent/tools/create-task.test.ts",
      "lib/agent/escalate-task.test.ts",
      "lib/jobs/handlers/tasks-due-sweep.ts",
      "lib/jobs/handlers/tasks-due-sweep.test.ts",
      "lib/flow-engine/registry/task-triggers.ts",
      "lib/flow-engine/registry/task-triggers.test.ts",
      "lib/flow-engine/nodes/create-task.ts",
      "lib/flow-engine/nodes/create-task.test.ts",
      "lib/flow-engine/nodes/complete-task.ts",
      "lib/flow-engine/nodes/complete-task.test.ts",
      "scripts/verify-tasks.mjs",
      "scripts/verify-tasks.impl.ts",
    ],
  },
  finanzas: {
    label: "Finanzas (gastos, proveedores, gastos que se repiten y resumen)",
    paths: [
      `${D}/finanzas`,
      "lib/finance",
      "components/finance",
      "app/api/v1/expenses",
      "components/settings/finance-auto-card.tsx",
      "components/settings/finance-categories-card.tsx",
      "components/settings/finance-settings.tsx",
      "lib/actions/finance-auto.ts",
      "lib/actions/finance-auto.test.ts",
      "lib/actions/finance-categories.ts",
      "lib/actions/finance-expenses.ts",
      "lib/actions/finance-expenses.commission-notice.test.ts",
      "lib/actions/finance-recurring.ts",
      "lib/actions/finance-recurring.test.ts",
      "lib/actions/finance-vendors.ts",
      "lib/jobs/handlers/finance-daily.ts",
      "lib/jobs/handlers/finance-daily.test.ts",
      "scripts/verify-expenses.mjs",
    ],
  },
  comisiones: {
    label: "Comisiones",
    paths: [
      "lib/commissions",
      "components/commissions",
      "app/api/v1/commissions",
      "lib/actions/commission-rules.ts",
      "lib/actions/commission-rules.test.ts",
      "lib/actions/commission-rules-lookup.ts",
      "lib/actions/commission-rules-lookup.test.ts",
      "lib/actions/commissions.ts",
      "lib/actions/commissions.test.ts",
      "lib/actions/commissions-ui.ts",
      "lib/jobs/handlers/commissions-payment.ts",
      "lib/jobs/handlers/commissions-payment.test.ts",
      "scripts/verify-commissions.mjs",
    ],
  },
  webhooks: {
    label: "Webhooks entrantes",
    paths: [
      `${D}/settings/integrations/webhooks`,
      "app/api/hooks",
      "lib/webhooks",
      "components/webhooks",
      "components/settings/integrations/webhooks-card.tsx",
      "components/flow-builder/panels/WebhookTriggerPanel.tsx",
      "components/flow-builder/panels/UpsertContactPanel.tsx",
      "components/flow-builder/nodes/upsert-contact-node.tsx",
      "lib/actions/webhook-endpoints.ts",
      "lib/actions/webhook-endpoints.test.ts",
      "lib/actions/webhook-flow-editor.ts",
      "lib/flow-engine/registry/webhook-triggers.ts",
      "lib/flow-engine/nodes/upsert-contact.ts",
      "scripts/verify-inbound-webhooks.mjs",
    ],
  },
  // No es un modulo de la app: lo que solo tiene sentido en el proyecto y no viaja a
  // ninguna plantilla. Columnas que el sistema ya no lee (la plantilla no las crea),
  // tests que fijan una migracion vieja del proyecto y comentarios que cuentan su
  // historia. Se marca con @plantilla-quitar(proyecto) y compania; no tiene rutas.
  proyecto: {
    label: "Solo del proyecto (historia, objetos sin uso)",
    paths: [],
  },
  sitio: {
    label: "Sitio publico del clon",
    paths: ["app/(sitio)", "public/sitio", "lib/site", "app/sitemap.ts"],
    // Lo que se pone en lugar de lo borrado (la version por defecto, como hace
    // scripts/export-template.mjs con cualquier clon).
    replacements: { "app/(sitio)": "scripts/template-files/sitio" },
  },
};

/** Los modulos que esta plantilla NO lleva (todos los del perfil). */
export const EXCLUDED = Object.keys(MODULES);

/**
 * Tests que no son de un modulo pero lo usan tanto (importan su codigo, o fijan sus claves,
 * alcances o datos) que sin el no compilan. Se borran si se excluye CUALQUIERA de sus
 * modulos. Es una lista provisoria (F2): la F3 decide cuales se adaptan a la plantilla.
 * Formato: { path, modules: [...], why }.
 */
const SCOPES = ["llamadas", "ventas", "comisiones", "tareas"];
export const excludeTests = [
  { path: "components/automations/step-tree-render.test.ts", modules: ["formularios"], why: "arma el editor de pasos con el «Solo si…» de Formularios" },
  { path: "lib/automations/condition-builder-model.test.ts", modules: ["formularios"], why: "usa las preguntas de un formulario" },
  { path: "lib/automations/editor-characterization.test.ts", modules: ["formularios"], why: "caracteriza las plantillas de Formularios" },
  { path: "lib/automations/explain-parity.test.ts", modules: ["formularios"], why: "prueba con respuestas de formularios" },
  { path: "lib/automations/flow-summary.test.ts", modules: ["formularios"], why: "usa las plantillas de Formularios" },
  { path: "lib/automations/step-catalog.test.ts", modules: ["formularios"], why: "usa las plantillas de Formularios" },
  { path: "lib/automations/step-tree-edit.test.ts", modules: ["formularios"], why: "usa el esquema de variables de Formularios" },
  { path: "lib/automations/step-tree-save.test.ts", modules: ["formularios"], why: "usa las plantillas de Formularios" },
  { path: "lib/automations/step-tree.test.ts", modules: ["formularios"], why: "usa las plantillas de Formularios" },
  { path: "lib/automations/test-values.test.ts", modules: ["formularios"], why: "prueba los valores de una respuesta de formulario" },
  { path: "lib/flow-engine/condition-catalog.test.ts", modules: ["formularios", "ventas"], why: "cruza los esquemas de Formularios y Ventas" },
  { path: "lib/antispam/rate-limit.test.ts", modules: ["formularios"], why: "usa los topes de Formularios" },
  { path: "lib/auth/export-endpoints.test.ts", modules: ["formularios"], why: "recorre los exports de respuestas y de fin de dia" },
  { path: "lib/flow-engine/automation-events-routing.test.ts", modules: ["tareas"], why: "enruta eventos de Tareas" },
  { path: "lib/flow-engine/automation-events-system.test.ts", modules: ["tareas"], why: "usa eventos de Tareas" },
  { path: "lib/flow-engine/origin.test.ts", modules: ["webhooks"], why: "fija el origen de las sesiones de webhook" },
  { path: "lib/contacts/characterization-c2.test.ts", modules: ["ventas"], why: "caracteriza el alta de contactos desde Ventas" },
  { path: "lib/actions/team.test.ts", modules: ["llamadas"], why: "prueba la marca de closer (Fathom)" },
  { path: "lib/ai-tasks/catalog.test.ts", modules: ["llamadas"], why: "fija las tres tareas de IA de Llamadas" },
  { path: "lib/ai-tasks/technical-preview.test.ts", modules: ["llamadas"], why: "fija la parte tecnica de las tareas de Llamadas" },
  { path: "lib/audit-history.test.ts", modules: ["tareas", "llamadas", "ventas", "formularios", "finanzas", "comisiones"], why: "fija las etiquetas del historial de los modulos" },
  { path: "lib/audit-query.test.ts", modules: ["comisiones", "ventas", "llamadas", "formularios", "tareas"], why: "fija los links y etiquetas de los modulos" },
  { path: "lib/actions/roles.patch.test.ts", modules: SCOPES, why: "fija los alcances de los modulos" },
  { path: "lib/actions/team.invite.test.ts", modules: SCOPES, why: "fija los alcances de los modulos" },
  { path: "lib/auth/permissions.test.ts", modules: SCOPES, why: "fija las claves y los alcances de los modulos" },
  { path: "lib/auth/roles-admin.test.ts", modules: SCOPES, why: "fija los alcances de los modulos" },
  { path: "lib/settings/permissions-characterization.test.ts", modules: SCOPES, why: "caracteriza los permisos con los alcances de los modulos" },
  { path: "lib/team/grant.test.ts", modules: SCOPES, why: "fija los alcances de los modulos" },
];

/** Paquetes de npm que solo usa un modulo (el export los saca del package.json). */
export const PACKAGES = {
  "@tanstack/react-table": ["tareas"],
  "pdf-lib": ["formularios"],
};

/**
 * Carpetas de herramientas de quien mantiene la plantilla: no son parte de lo que se
 * exporta y no se revisan como codigo de la app.
 */
export const TOOLING = ["scripts/plantilla", "plantilla-estudiantes", "scripts/verify-student-schema.mjs"];

const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
const under = (p, base) => p === base || p.startsWith(base + "/");

/** El modulo excluido al que pertenece una ruta, o null si se queda. */
export function moduleOfPath(path, excluded = EXCLUDED) {
  const p = norm(path);
  for (const id of excluded) {
    if (MODULES[id]?.paths.some((base) => under(p, base))) return id;
  }
  for (const t of excludeTests) {
    if (norm(t.path) === p && t.modules.some((m) => excluded.includes(m))) return t.modules[0];
  }
  return null;
}

/** true si la ruta no viaja a esta plantilla (es de un modulo excluido). */
export function isExcludedPath(path, excluded = EXCLUDED) {
  return moduleOfPath(path, excluded) !== null;
}

/** true si la ruta es una herramienta de la plantilla (no se exporta ni se revisa). */
export function isToolingPath(path) {
  const p = norm(path);
  return TOOLING.some((base) => under(p, base));
}
