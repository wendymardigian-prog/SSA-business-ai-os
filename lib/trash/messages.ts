/**
 * Los textos de la Papelera: qué frena un borrado, qué avisa, qué se va con el registro y por qué no se pudo
 * restaurar. Los códigos los devuelve la base (`trash_preview`, `trash_delete`, `trash_restore`, 00411).
 *
 * Módulo PURO: lo importan componentes del navegador.
 */

const BLOCKERS: Record<string, string> = {
  contract_signed: "Tiene un contrato firmado. La firma es una prueba legal y no se elimina.",
  commission_in_expense:
    "Una comisión ya está en un gasto (liquidada o por liquidar). Primero anulá ese gasto o sacá la comisión de la liquidación.",
  service_needs_permission: "No tenés permiso para eliminar servicios. Desmarcá «Eliminar también el servicio» o pedíselo a un Admin.",
  expense_automatic:
    "Este gasto lo crea el sistema (comisión del procesador, pauta de Meta, recurrente o liquidación). Si lo eliminás vuelve a aparecer: anulalo.",
  product_sold: "El producto tiene ventas. Archivalo en vez de eliminarlo.",
  content_scheduled: "La pieza tiene una red programada o publicándose. Primero desprogramala.",
};

/** Cómo se llama cada tabla cuando otro registro la usa (`in_use:<tabla>`). */
const TABLES: Record<string, string> = {
  "public.sales": "ventas",
  "public.payments": "pagos",
  "public.commissions": "comisiones",
  "public.expenses": "gastos (un ajuste apunta a este gasto)",
  "public.contract_signatures": "contratos firmados",
  "public.form_submissions": "respuestas de formularios",
  "public.contacts": "contactos",
  "public.forms": "formularios",
  "public.bookings": "agendas",
  "public.calls": "grabaciones",
  "public.conversations": "conversaciones",
  "public.content_posts": "piezas de contenido",
  "public.product_variants": "variantes de producto",
  "public.products": "productos",
  "app_servicio.services": "servicios",
};

const WARNINGS: Record<string, string> = {
  booking_active: "Es una agenda futura: se saca del calendario de Google sin avisarle al invitado. Para avisarle, usá Cancelar.",
  meta_sent: "Este cobro ya se le informó a Meta como compra. Eso no se puede retirar.",
  service_stays: "La venta tiene un servicio. Si no lo eliminás, el servicio queda, sin la venta.",
  has_service: "",
  commissions_go: "También se eliminan sus comisiones.",
  refunds_go: "También se eliminan sus reembolsos.",
  call_wont_return: "No vuelve a entrar cuando Fathom sincronice.",
  responses_go: "También se eliminan todas sus respuestas.",
  contact_stays: "El contacto que creó la respuesta queda.",
  commission_may_return: "Si se vuelve a calcular la comisión de ese pago, puede volver a aparecer. Para que no vuelva, anulala.",
  content_published: "Lo que ya se publicó en las redes no se baja.",
  conversation_reopens: "Si la persona vuelve a escribir, se abre una conversación nueva.",
};

/** Qué otras cosas se van con el registro (las cuentas de la vista previa). */
const COUNT_LABELS: Record<string, [string, string]> = {
  "public.payments": ["pago", "pagos"],
  "public.commissions": ["comisión", "comisiones"],
  "public.messages": ["mensaje", "mensajes"],
  "public.form_submissions": ["respuesta", "respuestas"],
  "public.form_versions": ["versión", "versiones"],
  "public.forms": ["formulario", "formularios"],
  "app_servicio_portal.portal_access": ["acceso al portal", "accesos al portal"],
  "public.eod_reports": ["reporte de fin de día", "reportes de fin de día"],
  "public.call_comments": ["comentario", "comentarios"],
  "public.product_variants": ["variante", "variantes"],
  "public.social_posts": ["publicación en redes", "publicaciones en redes"],
  "public.content_post_versions": ["versión", "versiones"],
  "app_servicio.services": ["servicio", "servicios"],
  "app_servicio.service_phases": ["fase", "fases"],
  "app_servicio.service_items": ["paso del camino", "pasos del camino"],
};

export function blockerMessage(code: string): string {
  if (code in BLOCKERS) return BLOCKERS[code];
  if (code.startsWith("in_use:")) {
    const table = code.slice("in_use:".length);
    return `Lo usan otros registros (${TABLES[table] ?? table}). Eliminá o cambiá eso primero.`;
  }
  return "No se puede eliminar.";
}

/**
 * Las tablas que un bloqueo propio ya explica: si la base devuelve los dos (por ejemplo `contract_signed` y
 * `in_use:public.contract_signatures`), el genérico «Lo usan otros registros» sobra y se ve repetido.
 */
const EXPLAINED_BY: Record<string, string> = {
  "public.contract_signatures": "contract_signed",
  "public.sales": "product_sold",
};

/** Los textos de los bloqueos, sin repetir: sin códigos iguales ni el genérico de una tabla que otro ya explica. */
export function blockerMessages(codes: readonly string[]): string[] {
  const set = new Set(codes);
  const shown = codes.filter((code) => {
    if (!code.startsWith("in_use:")) return true;
    const explainedBy = EXPLAINED_BY[code.slice("in_use:".length)];
    return !(explainedBy && set.has(explainedBy));
  });
  return Array.from(new Set(shown.map(blockerMessage)));
}

export function warningMessage(code: string): string | null {
  const text = WARNINGS[code];
  return text ? text : null;
}

/**
 * «3 pagos, 2 comisiones»: lo que se va además del registro. `root` es la tabla del registro mismo (no se cuenta).
 * Lo que no tiene etiqueta (tablas internas) no se nombra.
 */
export function describeCounts(counts: Record<string, number> | null | undefined, root: string | null): string[] {
  if (!counts) return [];
  const out: string[] = [];
  for (const [table, raw] of Object.entries(counts)) {
    const n = Number(raw) || 0;
    if (n <= 0) continue;
    const label = COUNT_LABELS[table];
    if (!label) continue;
    const extra = table === root ? n - 1 : n;
    if (extra <= 0) continue;
    out.push(`${extra} ${extra === 1 ? label[0] : label[1]}`);
  }
  return out;
}

const RESTORE: Record<string, string> = {
  forbidden: "No tenés permiso para restaurarlo.",
  not_found: "Ya se restauró o ya no está en la Papelera.",
  expired: "Pasaron los 30 días: ya no se puede restaurar.",
  busy: "El sistema está ocupado con esos datos. Probá de nuevo en unos segundos.",
  conflict: "Mientras tanto se creó algo que choca con esto (por ejemplo, otro registro con el mismo dato o la misma hora). No se restauró nada.",
};

const PARENTS: Record<string, string> = {
  "public.sales": "Restaurá primero la venta.",
  "public.contacts": "Su contacto ya no existe.",
  "public.products": "Restaurá primero el producto.",
  "public.product_variants": "Restaurá primero el producto.",
  "public.forms": "Restaurá primero el formulario.",
  "public.conversations": "Restaurá primero la conversación.",
  "app_servicio.services": "Restaurá primero el servicio.",
  "public.payments": "Restaurá primero el pago.",
  "public.expenses": "Restaurá primero el gasto.",
  "public.calls": "Restaurá primero la grabación.",
  "public.bookings": "Restaurá primero la agenda.",
};

export function restoreErrorMessage(code: string): string {
  if (code in RESTORE) return RESTORE[code];
  if (code.startsWith("missing_parent:")) {
    const table = code.slice("missing_parent:".length);
    return `No se puede restaurar todavía. ${PARENTS[table] ?? "Falta un registro del que depende."}`;
  }
  return "No pude restaurarlo.";
}

export function deleteErrorMessage(code: string): string {
  switch (code) {
    case "forbidden":
      return "No tenés permiso para eliminarlo.";
    case "not_found":
      return "Ya no existe (quizás otra persona lo eliminó).";
    default:
      return "No pude eliminarlo. Probá de nuevo.";
  }
}
