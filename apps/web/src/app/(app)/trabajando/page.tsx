import { redirect } from "next/navigation";

/**
 * "Dónde se está trabajando hoy" vive ahora adentro de Avance: es su ventana
 * "Hoy", con las órdenes activas dibujadas por su área real y cada empresa en
 * su color. La ruta queda para los links y marcadores guardados.
 */
export default function PaginaTrabajando() {
  redirect("/avance?dias=1");
}
