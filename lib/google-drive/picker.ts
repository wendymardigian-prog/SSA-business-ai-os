/**
 * El selector de archivos de Google Drive (Google Picker), en el navegador
 * (00374). developers.google.com/drive/picker/guides/overview
 *
 * Se carga a demanda (`apis.google.com/js/api.js`), solo cuando alguien aprieta
 * «Importar de Drive»: no se suma un script de Google a cada pantalla.
 *
 * Con `setAppId` (el numero del proyecto) cada archivo elegido queda accesible
 * para la app con el permiso `drive.file`: es lo que deja al servidor
 * descargarlo despues.
 */

import type { PickedDriveFile } from "./import-plan";

const SCRIPT_SRC = "https://apis.google.com/js/api.js";

/* Lo minimo del Picker que se usa, tipado a mano: no hay paquete oficial de tipos en el proyecto. */
interface PickerDoc {
  id: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number | string;
  url?: string;
}
interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
}
interface PickerApi {
  Action: { PICKED: string; CANCEL: string };
  ViewId: { DOCS: string };
  Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
  DocsView: new (viewId?: string) => {
    setIncludeFolders(v: boolean): unknown;
    setSelectFolderEnabled(v: boolean): unknown;
    setMode(mode: string): unknown;
  };
  DocsViewMode: { LIST: string };
  PickerBuilder: new () => PickerBuilder;
}
interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setMaxItems(max: number): PickerBuilder;
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
type GoogleWindow = Window & {
  gapi?: { load(name: string, cb: () => void): void };
  google?: { picker?: PickerApi };
};

let loading: Promise<PickerApi> | null = null;

function loadPicker(): Promise<PickerApi> {
  const w = window as GoogleWindow;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  if (loading) return loading;

  loading = new Promise<PickerApi>((resolve, reject) => {
    const onScript = () => {
      if (!w.gapi) {
        reject(new Error("No se pudo cargar Google"));
        return;
      }
      w.gapi.load("picker", () => {
        if (w.google?.picker) resolve(w.google.picker);
        else reject(new Error("No se pudo cargar el selector de Google Drive"));
      });
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing && w.gapi) {
      onScript();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = onScript;
    script.onerror = () => reject(new Error("No se pudo cargar Google. Revisá la conexión o un bloqueador de anuncios."));
    if (!existing) document.head.appendChild(script);
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Abre el selector y resuelve con lo elegido, o con `[]` si se cancela.
 */
export async function pickDriveFiles(config: {
  accessToken: string;
  apiKey: string;
  appId: string;
  maxItems: number;
}): Promise<PickedDriveFile[]> {
  const picker = await loadPicker();

  return new Promise<PickedDriveFile[]>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setIncludeFolders(true);
    view.setSelectFolderEnabled(true);
    view.setMode(picker.DocsViewMode.LIST);

    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setLocale("es")
      .setTitle("Elegí qué traer a Recursos")
      .setMaxItems(config.maxItems)
      .setCallback((data) => {
        if (data.action === picker.Action.CANCEL) resolve([]);
        if (data.action !== picker.Action.PICKED) return;
        resolve(
          (data.docs ?? []).map((doc) => ({
            id: doc.id,
            name: doc.name ?? "Archivo de Drive",
            mimeType: doc.mimeType ?? "application/octet-stream",
            sizeBytes: doc.sizeBytes === undefined || doc.sizeBytes === "" ? null : Number(doc.sizeBytes),
            url: doc.url ?? null,
          })),
        );
      })
      .build()
      .setVisible(true);
  });
}
