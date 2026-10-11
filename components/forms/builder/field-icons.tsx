import { AlignLeft, Calendar, CircleDot, EyeOff, Gauge, Hash, ListChecks, Mail, Paperclip, Phone, ShieldCheck, Star, Type, type LucideIcon } from "lucide-react";
import type { FormFieldType } from "@/lib/forms/fields";

export const FIELD_ICONS: Record<FormFieldType, LucideIcon> = {
  short_text: Type,
  long_text: AlignLeft,
  email: Mail,
  phone: Phone,
  number: Hash,
  single_select: CircleDot,
  multi_select: ListChecks,
  date: Calendar,
  rating: Star,
  nps: Gauge,
  file: Paperclip,
  consent: ShieldCheck,
  hidden: EyeOff,
};
