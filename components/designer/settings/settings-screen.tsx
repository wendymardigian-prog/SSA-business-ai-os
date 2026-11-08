"use client";

import type { UploadedFontEntry } from "@/lib/designer/settings-schema";
import type { DesignStyle } from "@/lib/designer/styles";
import type { PickableDesign } from "./extract-dialog";
import { FontsSection } from "./fonts-section";
import { StylesSection } from "./styles-section";
import { useRegisteredFonts, type PreviewFontFace } from "./use-registered-fonts";

export interface SettingsScreenProps {
  styles: DesignStyle[];
  google: string[];
  uploaded: UploadedFontEntry[];
  designs: PickableDesign[];
  /** La URL de Google Fonts con las familias que se dibujan en la pantalla (una sola). */
  googleHref: string | null;
  /** Links firmados de las fuentes subidas, para dibujar su vista «Aa Bb Cc». */
  previewFaces: PreviewFontFace[];
  curatedCount: number;
}

/** Ajustes del Diseñador IA: Estilos propios y Fuentes, una arriba de la otra (en una columna en el celular). */
export function SettingsScreen({ styles, google, uploaded, designs, googleHref, previewFaces, curatedCount }: SettingsScreenProps) {
  useRegisteredFonts(googleHref, previewFaces);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-4 sm:p-6">
      <StylesSection styles={styles} designs={designs} google={google} uploaded={uploaded} />
      <FontsSection google={google} uploaded={uploaded} curatedCount={curatedCount} />
    </div>
  );
}
