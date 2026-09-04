import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { estadisticasCalidad } from "@/lib/consultas";
import { diagnosticoDemandas } from "@/lib/tratamiento";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { BotonConsolidar } from "./boton-consolidar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Calidad de datos: acá se ve y se ataca el problema de fondo —
 * información duplicada, imprecisa o vieja repartida entre sistemas.
 */
export default async function PaginaCalidad() {
  const sesion = (await leerSesion())!;
  const [c, diag] = await Promise.all([estadisticasCalidad(sesion), diagnosticoDemandas(sesion)]);
  const puedeConsolidar = ["admin", "atencion_ciudadana", "planificacion"].includes(sesion.rol_cimba);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <TituloPagina
        titulo="Tratamiento de la demanda"
        sub="Nada de información estática: el sistema cruza cada reclamo contra la red vial, las reparaciones y los demás reclamos, y hace saltar solo lo que hay que limpiar. Cada demanda termina vinculada a un problema real, derivada con expediente o descartada con motivo."
      />

      {/* El pipeline explicado */}
      <Panel className="mb-6 p-5">
        <p className="mb-3 text-[10px] font-bold tracking-wider text-texto-3 uppercase">Cómo funciona la consolidación</p>
        <div className="grid gap-3 text-[13px] leading-relaxed text-texto-2 sm:grid-cols-3">
          <div>
            <span className="font-bold text-texto">1 · Demanda</span>
            <br />
            Lo que alguien pide: reclamo de un vecino, pedido del Concejo, intimación de la SAT. Entra como{" "}
            <b className="text-amarillo">sin vincular</b>: todavía nadie la cotejó contra el territorio.
          </div>
          <div>
            <span className="font-bold text-texto">2 · Cotejo</span>
            <br />
            ¿Es un problema nuevo, un duplicado de otro pedido, o algo ya reparado? La consolidación automática
            resuelve los casos claros (misma esquina, mismo tipo, buena geocodificación); lo dudoso queda para
            revisión humana con ayuda de IA.
          </div>
          <div>
            <span className="font-bold text-texto">3 · Incidente único</span>
            <br />
            Muchas demandas → un solo incidente priorizado. Se repara una vez y se les responde a todos los que
            pidieron, sin duplicar obra.
          </div>
        </div>
      </Panel>

      {/* Estado actual */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tarjeta valor={c.sinVincular} etiqueta="Sin vincular" color="var(--color-amarillo)" ayuda="Demandas que nadie cotejó aún. El objetivo es llevar este número a cero." />
        <Tarjeta valor={c.vinculadas} etiqueta="Ya vinculadas" color="var(--color-resuelto)" ayuda={`De las cuales ${numero(c.autoVinculadas)} se vincularon automáticamente.`} />
        <Tarjeta valor={c.vinculables} etiqueta="Aptas para cotejo automático" color="var(--color-celeste)" ayuda="Con ubicación confiable y tipo claro. Se auto-vinculan solo las corroboradas (2+ pedidos en la misma zona o un incidente abierto cerca); las sueltas esperan revisión." />
        <Tarjeta valor={c.sinVincular - c.vinculables} etiqueta="Requieren corrección" color="var(--color-encurso)" ayuda="Geocodificación dudosa, sin ubicación o sin tipo: se corrigen desde la bandeja (con IA) antes de poder cotejarlas." />
      </div>

      {puedeConsolidar && <BotonConsolidar vinculables={c.vinculables} consolidables={c.consolidables} />}

      {/* El tratamiento automático: lo que el cruce de datos hizo saltar solo */}
      <h2 className="mt-8 mb-1 text-sm font-bold tracking-wide uppercase">
        Señales automáticas <span className="font-normal text-texto-3">— el sistema propone, una persona confirma</span>
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-texto-3">
        Sobre <b className="text-texto-2">{numero(diag.abiertas)}</b> reclamos abiertos con ubicación, el cruce
        automático dejó <b className="text-resuelto">{numero(diag.limpias)}</b> en la cola limpia de bacheo y marcó
        el resto con alguna de estas señales (un reclamo puede tener más de una):
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TarjetaProblema
          n={diag.noEsBache}
          titulo="No es bache: calle de ripio"
          descripcion="Dicen «bache» pero caen donde la red vial marca ripio o cordón cuneta: ahí no se bachea, se pasa la máquina. Confirmar cada uno para derivarlo a Ingeniería."
          href="/calidad/tratamiento/no_es_bache"
        />
        <TarjetaProblema
          n={diag.duplicadas}
          titulo="Posibles duplicadas"
          descripcion="Otro reclamo anterior del mismo tipo a menos de 15 m. Se confirman una por una: el original junta la prioridad de ambos."
          href="/calidad/tratamiento/duplicada"
        />
        <TarjetaProblema
          n={diag.yaResueltas}
          titulo="Parecen ya resueltas"
          descripcion="Hay una reparación posterior al pedido a menos de 25 m. Confirmar vincula el reclamo a esa obra y queda respondible al vecino."
          href="/calidad/tratamiento/ya_resuelta"
        />
        <TarjetaProblema
          n={diag.derivarSat}
          titulo="Para la S.A.T. (con nota)"
          descripcion={`Pérdidas de agua, tapas y sumideros: se derivan todos juntos con la nota administrativa numerada al Director de la S.A.T. (${numero(diag.satConFoto)} traen foto).`}
          href="/calidad/tratamiento/derivar_sat"
        />
      </div>

      {/* Problemas de calidad */}
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide uppercase">
        Calidad del dato <span className="font-normal text-texto-3">— clic para abrir cada bandeja filtrada</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <TarjetaProblema
          n={c.geocodBaja}
          titulo="Geocodificación imprecisa"
          descripcion="La dirección no se pudo ubicar con confianza (ej: 'Cris Alvarez' abreviado, esquinas ambiguas). No se auto-vinculan jamás: hay que corregir el punto."
          href="/demandas?calidad=geocod_baja"
        />
        <TarjetaProblema
          n={c.sinUbicacion}
          titulo="Sin ubicación"
          descripcion="Demandas sin coordenadas (ej: reclamos AC con la coordenada por defecto de la repartición, descartada por seguridad). Ubicarlas en el mapa desde la bandeja."
          href="/demandas?calidad=sin_ubicacion"
        />
        <TarjetaProblema
          n={c.sinFecha}
          titulo="Sin fecha de origen"
          descripcion="Vienen del consolidado histórico de QGIS sin fecha. Pueden ser viejas: verificar vigencia antes de despachar."
          href="/demandas?calidad=sin_fecha"
        />
        <TarjetaProblema
          n={c.antiguas}
          titulo="Antiguas (> 1 año) aún abiertas"
          descripcion="Pedidos con más de un año sin resolución ni descarte. Candidatas a verificar en territorio: puede que ya no existan o que sean crónicas."
          href="/demandas?calidad=antiguas"
        />
      </div>

      <p className="mt-6 text-xs leading-relaxed text-texto-3">
        Regla de oro: las demandas <b>nunca se borran ni se fusionan destructivamente</b> — cada pedido conserva su
        origen y trazabilidad. Vincular y descartar siempre dejan rastro en la auditoría.{" "}
        <Link href="/cargar" className="text-celeste hover:underline">
          ¿Datos nuevos? Cargalos acá →
        </Link>
      </p>
    </div>
  );
}

function Tarjeta({ valor, etiqueta, color, ayuda }: { valor: number; etiqueta: string; color: string; ayuda: string }) {
  return (
    <Panel className="cursor-help p-4" >
      <div title={ayuda}>
        <div className="num text-2xl font-extrabold" style={{ color }}>
          {numero(valor)}
        </div>
        <div className="mt-0.5 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">{etiqueta}</div>
        <p className="mt-1.5 text-[11px] leading-snug text-texto-3">{ayuda}</p>
      </div>
    </Panel>
  );
}

function TarjetaProblema({ n, titulo, descripcion, href }: { n: number; titulo: string; descripcion: string; href: string }) {
  return (
    <Link href={href} className="block">
      <Panel className="h-full p-4 transition hover:border-celeste/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold">{titulo}</div>
            <p className="mt-1 text-xs leading-relaxed text-texto-2">{descripcion}</p>
          </div>
          <span className={`num shrink-0 text-xl font-extrabold ${n > 0 ? "text-amarillo" : "text-resuelto"}`}>
            {numero(n)}
          </span>
        </div>
      </Panel>
    </Link>
  );
}
