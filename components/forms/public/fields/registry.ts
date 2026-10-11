import type { ComponentType } from "react";
import type { FormFieldType } from "@/lib/forms/fields";
import { ConsentField } from "./consent-field";
import { MultiSelectField, SingleSelectField } from "./choice-field";
import { FileField } from "./file-field";
import { NpsField, RatingField } from "./scale-field";
import { DateField, EmailField, LongTextField, NumberField, PhoneField, ShortTextField } from "./text-field";
import type { FieldProps } from "./shared";

/**
 * Un componente por tipo de campo. Los 13 tipos están acá (un test recorre la
 * lista): `hidden` es `null` a propósito, porque un campo oculto no tiene
 * interfaz; su valor sale de la URL, de la atribución o del servidor.
 */
export const FIELD_RENDERERS: Record<FormFieldType, ComponentType<FieldProps> | null> = {
  short_text: ShortTextField,
  long_text: LongTextField,
  email: EmailField,
  phone: PhoneField,
  number: NumberField,
  single_select: SingleSelectField,
  multi_select: MultiSelectField,
  date: DateField,
  rating: RatingField,
  nps: NpsField,
  file: FileField,
  consent: ConsentField,
  hidden: null,
};
