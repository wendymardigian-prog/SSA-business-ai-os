/**
 * La guía corta del aviso «Ningún contacto de este período trae datos de anuncio» (Tirón 2, E1): qué parámetros poner en la URL
 * de cada anuncio para que cada persona que llegue quede vinculada a su campaña, conjunto y anuncio. Es la misma plantilla de
 * `docs/atribucion.md` ("Guía: parámetros de URL para los anuncios"); un test las mantiene iguales.
 */
export const ADS_URL_PARAMS = "utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";

export const ADS_NO_SIGNAL_MESSAGE = "Ningún contacto de este período trae datos de anuncio. Configurá los parámetros de URL de tus anuncios.";

export const ADS_GUIDE_STEPS: readonly string[] = [
  "En Meta, abrí el anuncio y buscá «Parámetros de URL» (en la sección de destino).",
  "Pegá la plantilla de abajo tal cual: Meta reemplaza {{campaign.id}}, {{ad.id}} y {{adset.id}} por los ids reales de cada anuncio.",
  "Guardá. Los contactos que lleguen desde ahí quedan vinculados solos; los de antes los podés vincular a mano en «Sin vincular».",
];
