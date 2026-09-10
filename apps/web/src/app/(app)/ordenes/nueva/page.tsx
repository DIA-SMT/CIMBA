import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import {
  colectoresConImbornales,
  listarEmpresas,
  obtenerCapacidad,
  opcionesAmbito,
  resumenCircuitos,
} from "@/lib/ordenes";
import { TituloPagina } from "@/components/ui";
import { FormularioOrden } from "./formulario-orden";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function PaginaNuevaOrden({
  searchParams,
}: {
  searchParams: Promise<{ recorrido?: string }>;
}) {
  const sp = await searchParams;
  /**
   * Recorrido dibujado en el mapa: llega como "lon,lat;lon,lat…". Se valida
   * acá —no se confía en el query— y entra al formulario como un tramo ya
   * armado.
   */
  const recorrido = (sp.recorrido ?? "")
    .split(";")
    .map((par) => par.split(",").map(Number))
    .filter(
      (c): c is [number, number] =>
        c.length === 2 &&
        Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
        c[0]! > -65.6 && c[0]! < -64.9 && c[1]! > -27.2 && c[1]! < -26.5,
    )
    .slice(0, 500);
  const sesion = (await leerSesion())!;
  const [circuitos, empresas, parametros, distritos, barrios, corredores, colectores] = await Promise.all([
    resumenCircuitos(sesion),
    listarEmpresas(sesion),
    obtenerCapacidad(sesion),
    opcionesAmbito(sesion, "distrito"),
    opcionesAmbito(sesion, "barrio"),
    opcionesAmbito(sesion, "corredor"),
    colectoresConImbornales(sesion),
  ]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link
        href="/ordenes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto"
      >
        <ArrowLeft size={15} /> Órdenes
      </Link>
      <TituloPagina
        titulo="Nueva orden de trabajo"
        sub="Primero qué trabajo es, después por dónde se define, y recién ahí quién lo hace: elegí los puntos y emití el papel."
      />
      <FormularioOrden
        circuitos={circuitos.map((c) => ({
          id: c.id,
          codigo: c.codigo,
          pendientes: c.pendientes,
          demandasAbiertas: c.demandasAbiertas,
          empresaId: c.empresaId,
          empresaNombre: c.empresaNombre,
        }))}
        distritos={distritos}
        barrios={barrios}
        corredores={corredores}
        colectores={colectores}
        empresas={empresas}
        parametros={parametros}
        recorrido={recorrido.length >= 2 ? recorrido : undefined}
      />
    </div>
  );
}
