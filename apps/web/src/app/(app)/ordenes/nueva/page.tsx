import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { listarEmpresas, obtenerCapacidad, resumenCircuitos } from "@/lib/ordenes";
import { TituloPagina } from "@/components/ui";
import { FormularioOrden } from "./formulario-orden";

export const dynamic = "force-dynamic";

export default async function PaginaNuevaOrden() {
  const sesion = (await leerSesion())!;
  const [circuitos, empresas, parametros] = await Promise.all([
    resumenCircuitos(sesion),
    listarEmpresas(sesion),
    obtenerCapacidad(sesion),
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
        sub="La demanda del circuito contra la oferta de la empresa: elegí los baches, quién los hace y emití el papel."
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
        empresas={empresas}
        parametros={parametros}
      />
    </div>
  );
}
