import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { conRls, sql } from "@cimba/db";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { CorrectorPines } from "./corrector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * La bandeja de CORRECCIÓN DE PINES EN LOTE: el mayor tapón de la línea de
 * montaje (ubicación dudosa → el sistema no trabaja solo) atacado por tandas.
 * La IA propone, la persona revisa la lista y confirma.
 */
export default async function PaginaPines() {
  const sesion = (await leerSesion())!;
  const claims = { sub: sesion.sub, rol_cimba: sesion.rol_cimba, id_persona: sesion.id_persona, id_empresa: sesion.id_empresa };

  const filas = (await conRls(claims, async (tx) =>
    (await tx.execute(sql`
      select
        count(*) filter (where metadata->>'pin_geocoder_fallo' is null
                           and metadata->>'pin_omitido' is null)::int as pendientes,
        count(*) filter (where metadata->>'pin_geocoder_fallo' is not null)::int as a_mano,
        count(*) filter (where metadata->>'pin_omitido' is not null)::int as omitidas
      from demandas d
      where d.estado in ('recibida','en_validacion')
        and coalesce(d.direccion_normalizada, d.direccion_texto) is not null
        and (d.geom is null or coalesce(d.geocod_confianza, 0) < 0.75)
    `)) as unknown as Array<Record<string, unknown>>,
  ))[0] ?? {};

  const pendientes = Number(filas.pendientes ?? 0);
  const aMano = Number(filas.a_mano ?? 0);
  const puedeAplicar = ["admin", "planificacion", "atencion_ciudadana"].includes(sesion.rol_cimba);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/calidad" className="text-sm text-texto-2 hover:text-texto">← Tratamiento de la demanda</Link>
      <TituloPagina
        titulo={`Corrección de pines (${numero(pendientes)})`}
        sub="Pedidos con la ubicación dudosa: el sistema no los trabaja solo hasta que el pin sea confiable. La IA geocodifica una tanda y propone; vos revisás y confirmás."
      />

      <Panel className="mb-4 p-4 text-[13px] leading-relaxed text-texto-2">
        Cada tanda geocodifica <b>20 direcciones</b> contra el callejero real y propone solo las que
        clava con <b>altura o esquina exacta</b> (confianza ≥ 75%) — un pin que sigue siendo dudoso no
        sirve para trabajar. Lo que el geocodificador no resuelve queda contado aparte
        {aMano > 0 && (
          <>
            {" "}
            (hoy: <b className="num">{numero(aMano)}</b>)
          </>
        )}{" "}
        y se corrige a mano desde la ficha, arrastrando el pin en el mini-mapa. Al aplicar, cada pedido
        recupera barrio, circuito y quién lo resuelve, y queda listo para el relevamiento del circuito.
      </Panel>

      {puedeAplicar ? (
        <CorrectorPines pendientesIniciales={pendientes} />
      ) : (
        <p className="text-center text-xs text-texto-3">
          Proponer y aplicar correcciones es tarea de planificación o atención ciudadana; tu rol solo puede ver esta página.
        </p>
      )}
    </div>
  );
}
