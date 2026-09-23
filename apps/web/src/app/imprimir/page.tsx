import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { datosAvance, leerTerritorio, ventanaValida } from "@/lib/avance";
import { ResumenImprimible } from "./resumen-imprimible";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = { title: "Resumen de avance · CIMBA" };

/**
 * EL RESUMEN PARA IMPRIMIR: una hoja A4 con el mapa, las cifras del período,
 * quién produjo, dónde se avanzó más, lo que está en obra y lo que falta.
 * Para llevar a una reunión sin pantalla. Vive fuera del route group (app):
 * sin menú ni encabezado, que en papel no sirven.
 *
 * Los mismos datos que Avance, con la misma ventana y el mismo recorte:
 * /imprimir?dias=30&distrito=9.
 */
export default async function PaginaImprimir({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; distrito?: string; barrio?: string }>;
}) {
  const sesion = await leerSesion();
  if (!sesion) redirect("/acceso");
  if (sesion.rol_cimba === "empresa") redirect("/empresa");

  const sp = await searchParams;
  const dias = ventanaValida(sp.dias);
  const datos = await datosAvance(sesion, { dias, territorio: leerTerritorio(sp) });

  return <ResumenImprimible datos={datos} dias={dias} />;
}
