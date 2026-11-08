/**
 * Puntos de extensión del Diseñador IA (§9.3).
 *
 * - `registerDesignVariables`: otro módulo suma un grupo de variables (por
 *   ejemplo Servicios, `service.*`) y, opcionalmente, un ORIGEN de sujeto (un
 *   "Servicio" para elegir en "Generar para…" y en el nodo).
 * - `onDesignGenerated`: avisa a un módulo cuando una generación queda `ready`
 *   (Servicios completa el paso "Certificado").
 *
 * En esta corrida quedan VACÍOS: nadie registra nada. Un test registra uno de
 * prueba y lo saca. Un módulo nuevo registra lo suyo en un archivo propio que
 * se importa una vez del lado del servidor.
 *
 * Módulo puro (estado en memoria del proceso).
 */

export interface RegisteredVariable {
  key: string;
  label: string;
  sample: string;
}

export interface SubjectRef {
  module: string;
  type: string;
  id: string;
  label: string;
}

export interface DesignVariableRegistration {
  /** Clave del grupo, también el prefijo de sus variables ("service"). */
  group: string;
  /** Rótulo del grupo en el menú ("Servicio"). */
  label: string;
  /** Si el módulo además es un ORIGEN de sujeto, su nombre visible ("Servicio"). */
  source?: string;
  vars: RegisteredVariable[];
  /** Los valores de sus variables para un sujeto. Nunca lanza: lo que no sabe, no lo devuelve. */
  resolve?: (ctx: { workspaceId: string; subject: SubjectRef | null; contactId: string | null }) => Promise<Record<string, string>>;
}

export interface GeneratedDesign {
  designId: string;
  workspaceId: string;
  templateId: string;
  code: string;
  subjectContactId: string | null;
  subjectRef: SubjectRef | null;
}

export type DesignGeneratedHandler = (design: GeneratedDesign) => Promise<void> | void;

const registrations: DesignVariableRegistration[] = [];
const generatedHandlers: DesignGeneratedHandler[] = [];

const GROUP_RE = /^[a-z][a-z0-9_]{1,30}$/;
const RESERVED_GROUPS = new Set(["contact", "workspace", "design", "propias", "contacto", "negocio", "diseno"]);

/** Suma un grupo de variables. Lanza si el grupo choca con uno del sistema o ya está registrado. */
export function registerDesignVariables(reg: DesignVariableRegistration): () => void {
  if (!GROUP_RE.test(reg.group) || RESERVED_GROUPS.has(reg.group)) throw new Error(`El grupo de variables «${reg.group}» no es válido o es del sistema`);
  if (registrations.some((r) => r.group === reg.group)) throw new Error(`El grupo de variables «${reg.group}» ya está registrado`);
  for (const v of reg.vars) {
    if (!v.key.startsWith(`${reg.group}.`)) throw new Error(`La variable «${v.key}» tiene que empezar con «${reg.group}.»`);
  }
  registrations.push(reg);
  return () => {
    const i = registrations.indexOf(reg);
    if (i >= 0) registrations.splice(i, 1);
  };
}

export function registeredVariableGroups(): readonly DesignVariableRegistration[] {
  return registrations;
}

/** Los orígenes de sujeto registrados (además de "Contacto", que es del sistema). */
export function registeredSubjectSources(): { group: string; source: string }[] {
  return registrations.filter((r) => r.source).map((r) => ({ group: r.group, source: r.source as string }));
}

/** Resuelve los valores de todos los grupos registrados. Un grupo que falla no frena a los demás. */
export async function resolveRegisteredValues(ctx: { workspaceId: string; subject: SubjectRef | null; contactId: string | null }): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const reg of registrations) {
    if (!reg.resolve) continue;
    try {
      const got = await reg.resolve(ctx);
      for (const [k, v] of Object.entries(got)) if (k.startsWith(`${reg.group}.`) && typeof v === "string") values[k] = v;
    } catch (error) {
      console.error(`[designer] el grupo de variables ${reg.group} falló al resolver:`, error instanceof Error ? error.message : "error");
    }
  }
  return values;
}

/** Se suscribe a las generaciones que quedan listas. Devuelve la función para desuscribirse. */
export function onDesignGenerated(handler: DesignGeneratedHandler): () => void {
  generatedHandlers.push(handler);
  return () => {
    const i = generatedHandlers.indexOf(handler);
    if (i >= 0) generatedHandlers.splice(i, 1);
  };
}

/** Avisa a los suscriptos. Nunca lanza: un módulo que falla no tumba la generación. */
export async function emitDesignGenerated(design: GeneratedDesign): Promise<void> {
  for (const handler of [...generatedHandlers]) {
    try {
      await handler(design);
    } catch (error) {
      console.error("[designer] un aviso de generación falló:", error instanceof Error ? error.message : "error");
    }
  }
}
