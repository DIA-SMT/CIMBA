import { notFound } from "next/navigation";
import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { TituloPagina } from "@/components/ui";
import { MapaOrdenes } from "../ordenes/mapa-ordenes";

export const dynamic = "force-dynamic";

/**
 * DÓNDE SE ESTÁ TRABAJANDO HOY.
 *
 * Nació de un problema concreto: dos inspectores generaron la misma obra en
 * la misma bocacalle porque nadie veía lo que ya estaba mandado. El mapa
 * existía —dentro de Órdenes, detrás de un botón, con "últimos 30 días" por
 * defecto—, pero la pregunta de la mañana es otra y es diaria: qué se está
 * haciendo HOY y de quién es cada cuadra. Por eso tiene su propia pantalla y
 * abre en el recorte del día.
 *
 * Y muestra las dos cosas, que es lo que le faltaba: lo mandado por órdenes de
 * CIMBA y lo que las empresas informan por planilla, por el SIGOV o por su
 * propia app. Con solo lo primero, media ciudad se veía vacía cuando no lo
 * estaba.
 */
export default async function PaginaTrabajando() {
  const sesion = (await leerSesion())!;
  // Es el tablero de asignación de trabajo de toda la ciudad: la misma regla
  // que ya aplica el endpoint, acá para que no se llegue a una pantalla vacía.
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) notFound();

  return (
    <div className="mx-auto max-w-7xl p-6">
      <TituloPagina
        titulo="Dónde se está trabajando"
        sub="Cada empresa con su color: lo que se mandó por orden y lo que informaron por planilla o por su app. Para no mandar dos veces la misma cuadra."
        extra={
          <Link
            href="/ordenes"
            className="rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
          >
            Ir a Órdenes
          </Link>
        }
      />
      <MapaOrdenes siempreAbierto diasInicial={1} alto={560} />
    </div>
  );
}
