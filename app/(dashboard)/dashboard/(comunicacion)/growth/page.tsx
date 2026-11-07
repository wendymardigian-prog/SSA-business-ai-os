import { redirect } from "next/navigation";

/** Growth paso a llamarse Comentarios (y a ser de solo lectura): los links viejos siguen andando. */
export default function GrowthPage() {
  redirect("/dashboard/comentarios");
}
