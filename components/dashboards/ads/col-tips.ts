/**
 * Lo que explica cada encabezado de las tablas del desglose. Los textos son
 * los de la referencia, tal cual: son la definicion que se le muestra a quien
 * no sabe que es una "frecuencia" o un "ThruPlay".
 */

export type ColTip = { title: string; body: string };

export const COL_TIPS: Record<string, ColTip> = {
  "Campaña": { title: "Campaña", body: "Nombre de la campaña tal como está configurada en Meta Ads Manager." },
  "Ad Set": { title: "Ad Set", body: "Conjunto de anuncios dentro de una campaña: define audiencia, presupuesto y ubicaciones." },
  "Anuncio": { title: "Anuncio", body: "Creatividad individual (imagen, video o carrusel) servida a la audiencia." },
  "Estado": { title: "Estado", body: "Activa: la campaña está corriendo. Pausada: detenida temporalmente." },
  "Gasto": { title: "Gasto", body: "Inversión total ejecutada en el período seleccionado." },
  "Impr.": { title: "Impresiones", body: "Cantidad total de veces que tu anuncio fue mostrado en pantalla. Una misma persona puede generar múltiples impresiones." },
  "Alcance": { title: "Alcance", body: "Número de personas únicas que vieron tu anuncio al menos una vez. A diferencia de las impresiones, no cuenta repeticiones." },
  "Frec.": { title: "Frecuencia", body: "Promedio de veces que cada persona vio tu anuncio. Fórmula: Impresiones ÷ Alcance. Por encima de 3–4 puede generar fatiga de audiencia." },
  "Clics": { title: "Clics", body: "Total de clics en el anuncio durante el período seleccionado." },
  "CTR": { title: "CTR — Click-Through Rate", body: "Porcentaje de personas que vieron tu anuncio y hicieron clic. Fórmula: Clics ÷ Impresiones. Promedio saludable en Meta: 1–3%. Arriba de 3% es muy bueno." },
  "CPM": { title: "CPM — Costo por Mil impresiones", body: "Cuánto pagás cada vez que tu anuncio se muestra 1.000 veces. Refleja el costo de \"comprar audiencia\". Un CPM bajo puede indicar baja competencia o audiencia más amplia." },
  "CPC": { title: "CPC — Costo por Clic", body: "Cuánto te cuesta cada clic al sitio web. Fórmula: Gasto total ÷ Clics. Cuanto más bajo, más eficiente es tu anuncio para generar tráfico." },
  "Leads": { title: "Leads", body: "Cantidad de personas que completaron el formulario de contacto o lead form configurado como objetivo de la campaña. Si es 0, revisá que el píxel o el formulario nativo estén bien conectados." },
  "CPL": { title: "CPL — Costo por Lead", body: "Cuánto te costó conseguir cada lead. Fórmula: Gasto total ÷ Leads. Se muestra \"—\" cuando no hay leads aún." },
  "Conv.": { title: "Conv. — Conversiones", body: "Total de acciones valiosas completadas: pueden ser compras, registros, suscripciones u otro evento configurado como conversión. Requiere el Meta Pixel o Conversions API activo en tu sitio." },
  "Calidad": { title: "Quality — Calidad", body: "Ranking de calidad que Meta asigna a tu anuncio comparándolo con anuncios similares que compiten por la misma audiencia. \"Superior\" significa que tu anuncio es más relevante que la mayoría." },
  "Eng.": { title: "Eng. Rank — Engagement Ranking", body: "Qué tan probable es que la gente interactúe con tu anuncio (likes, comentarios, shares) comparado con anuncios similares. Un ranking bajo puede elevar tu CPM." },
};

/** En la tabla de anuncios, "Conv." es el ranking de conversion, no las conversiones. */
export const COL_TIPS_ADS: Record<string, ColTip> = {
  ...COL_TIPS,
  "Conv.": { title: "Conv. Rank — Conversion Rate Ranking", body: "Qué tan probable es que alguien convierta después de ver tu anuncio, comparado con campañas similares. Si está \"Inferior\", Meta puede estar priorizando otros anunciantes." },
};
