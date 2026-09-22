import { redirect } from "next/navigation";

/** La portada es Avance: la ciudad contada desde lo hecho. El rol empresa
 *  nunca llega acá (el layout de (app) lo manda a su portal). */
export default function Inicio() {
  redirect("/avance");
}
