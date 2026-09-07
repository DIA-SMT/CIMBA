import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { listarEmpresas, obtenerCapacidad, resumenCircuitos } from "@/lib/ordenes";
import { TituloPagina } from "@/components/ui";
import { Simulador } from "./simulador";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * EL SIMULADOR DE ESCENARIOS: "¿y si mando dos cuadrillas más al SO?" —
 * las palancas de la dotación contra la deuda real de cada circuito, con la
 * regla de capacidad del propio Director. Planificar deja de ser intuición.
 * El cálculo es transparente y corre en el navegador: mover una palanca
 * responde al instante.
 */
export default async function PaginaSimulador() {
  const sesion = (await leerSesion())!;
  const [circuitos, empresas, capacidad] = await Promise.all([
    resumenCircuitos(sesion),
    listarEmpresas(sesion),
    obtenerCapacidad(sesion),
  ]);

  const cuadrillasActivas = empresas.filter((e) => e.activa).reduce((a, e) => a + e.cuadrillas, 0);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/ordenes" className="text-sm text-texto-2 hover:text-texto">← Órdenes</Link>
      <TituloPagina
        titulo="Simulador de escenarios"
        sub="Mové las palancas y mirá en cuántos días baja la deuda, circuito por circuito — con tu propia regla de capacidad. Nada de esto emite órdenes: es para pensar antes de mandar."
      />
      <Simulador
        circuitos={circuitos
          .filter((c) => c.pendientes > 0)
          .map((c) => ({ codigo: c.codigo, pendientes: c.pendientes, empresa: c.empresaNombre ?? null }))}
        capacidad={capacidad}
        cuadrillasActivas={cuadrillasActivas}
      />
    </div>
  );
}
