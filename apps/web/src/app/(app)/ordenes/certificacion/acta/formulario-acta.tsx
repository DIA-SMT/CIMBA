"use client";

import { FileSignature } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { desviacionPct, MUESTREO_MINIMO_PCT, sortearMuestra } from "@cimba/domain";
import { firmarActaMedicion } from "@/lib/acciones-certificacion";
import { mensajeDeError } from "@/lib/errores";
import { fechaCorta, numero } from "@/lib/formato";
import { Panel } from "@/components/ui";
import { GaleriaFotos, type FotoVisor } from "@/components/visor-fotos";
import { ChipMiniMapa } from "@/components/mapa/mini-mapa";

interface Punto {
  itemId: number;
  ordenId: number;
  ordenNumero: string;
  direccion: string | null;
  reportadoEn: string | null;
  anchoM: number | null;
  largoM: number | null;
  m2Informado: number;
  revisado: boolean;
  lat: number | null;
  lon: number | null;
  fotos: Array<{ momento: string; url: string }>;
}

type Medida = { ancho: string; largo: string; m2: string };

/* Sobre la foto, con fondo oscuro fijo: hex y no tokens (ver visor-fotos). */
const COLOR_MOMENTO: Record<string, string> = { antes: "#3987e5", durante: "#d95926", despues: "#199e70" };
const ETIQUETA_MOMENTO: Record<string, string> = { antes: "Antes", durante: "Durante", despues: "Después" };

/** "2,5" o "2.5" → 2.5; vacío o basura → null. */
const leer = (s: string): number | null => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Lo medido de un punto: el m² escrito, o ancho × largo. */
const m2DeMedida = (m: Medida | undefined): number | null => {
  if (!m) return null;
  const directo = leer(m.m2);
  if (directo != null) return directo;
  const a = leer(m.ancho);
  const l = leer(m.largo);
  return a != null && l != null ? Math.round(a * l * 100) / 100 : null;
};

const claseInput =
  "num w-16 rounded-md border border-borde-2 bg-panel-2 px-2 py-1.5 text-right text-sm placeholder:text-texto-3";

/**
 * EL ACTA, EN LA PANTALLA.
 *
 * Qué entra (por defecto todo lo pendiente, se puede sacar lo que no se
 * recorrió), qué hay que medir —todo en medición total; la muestra sorteada en
 * muestreo, y se puede medir de más—, y lo que dio. La desviación se ve en
 * vivo, antes de firmar. Lo escrito se guarda en este navegador mientras se
 * arma: medir sesenta baches lleva más de una sentada.
 */
export function FormularioActa({
  empresaId,
  empresa,
  modalidad,
  motivo,
  hoy,
  inspector,
  puntos,
}: {
  empresaId: number;
  empresa: string;
  modalidad: "total" | "muestreo";
  motivo: string;
  /** 'YYYY-MM-DD' de Tucumán: la fecha del acta y la semilla del sorteo. */
  hoy: string;
  inspector: string;
  puntos: Punto[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fuera, setFuera] = useState<Set<number>>(new Set());
  const [filtroOrden, setFiltroOrden] = useState<number | null>(null);
  const [medidas, setMedidas] = useState<Record<number, Medida>>({});
  const [firmaInspector, setFirmaInspector] = useState(inspector);
  const [firmaContratista, setFirmaContratista] = useState("");
  const [observaciones, setObservaciones] = useState("");

  /* El borrador vive en este navegador: si se cierra la pestaña a mitad de
     camino, lo medido no se pierde. Nunca viaja al servidor hasta firmar. */
  const claveBorrador = `cimba:acta:${empresaId}`;
  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(claveBorrador) ?? "null") as {
        fuera?: number[];
        medidas?: Record<number, Medida>;
        firmaContratista?: string;
        observaciones?: string;
      } | null;
      if (b) {
        setFuera(new Set(b.fuera ?? []));
        setMedidas(b.medidas ?? {});
        setFirmaContratista(b.firmaContratista ?? "");
        setObservaciones(b.observaciones ?? "");
      }
    } catch {
      /* sin borrador */
    }
  }, [claveBorrador]);
  useEffect(() => {
    try {
      localStorage.setItem(
        claveBorrador,
        JSON.stringify({ fuera: [...fuera], medidas, firmaContratista, observaciones }),
      );
    } catch {
      /* almacenamiento bloqueado: se arma sin borrador */
    }
  }, [claveBorrador, fuera, medidas, firmaContratista, observaciones]);

  const ordenes = useMemo(
    () => [...new Map(puntos.map((p) => [p.ordenId, p.ordenNumero])).entries()],
    [puntos],
  );
  const incluidos = puntos.filter((p) => !fuera.has(p.itemId));
  const aMedir = useMemo(
    () =>
      new Set(
        modalidad === "total"
          ? incluidos.map((p) => p.itemId)
          : sortearMuestra(
              incluidos.map((p) => p.itemId),
              `${hoy}:${empresaId}`,
              MUESTREO_MINIMO_PCT,
            ),
      ),
    // incluidos se recalcula de fuera/puntos
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modalidad, fuera, puntos, hoy, empresaId],
  );

  const medidos = incluidos
    .map((p) => ({ p, m2: m2DeMedida(medidas[p.itemId]) }))
    .filter((x): x is { p: Punto; m2: number } => x.m2 != null);
  const faltan = [...aMedir].filter((id) => m2DeMedida(medidas[id]) == null).length;
  const desvio = desviacionPct(medidos.map((x) => ({ informado: x.p.m2Informado, medido: x.m2 })));
  const m2Informados = incluidos.reduce((s, p) => s + p.m2Informado, 0);
  const m2Certificados = incluidos.reduce((s, p) => s + (m2DeMedida(medidas[p.itemId]) ?? p.m2Informado), 0);
  const visibles = filtroOrden == null ? puntos : puntos.filter((p) => p.ordenId === filtroOrden);

  const cambiar = (id: number, campo: keyof Medida, valor: string) =>
    setMedidas((v) => ({ ...v, [id]: { ...(v[id] ?? { ancho: "", largo: "", m2: "" }), [campo]: valor } }));

  const firmar = () => {
    setError(null);
    if (incluidos.length === 0) return setError("No hay ningún punto en el acta.");
    if (faltan > 0) {
      return setError(
        modalidad === "total"
          ? `Falta medir ${faltan} punto(s): esta empresa está en medición total.`
          : `Falta medir ${faltan} de los puntos sorteados.`,
      );
    }
    if (firmaInspector.trim().length < 3 || firmaContratista.trim().length < 3) {
      return setError("Faltan los nombres de quienes firman: el inspector y el representante de la empresa.");
    }
    startTransition(async () => {
      try {
        const r = await firmarActaMedicion({
          empresaId,
          itemIds: incluidos.map((p) => p.itemId),
          mediciones: medidos.map((x) => ({ itemId: x.p.itemId, m2Medido: x.m2 })),
          firmaInspector: firmaInspector.trim(),
          firmaContratista: firmaContratista.trim(),
          observaciones: observaciones.trim() || undefined,
        });
        try {
          localStorage.removeItem(claveBorrador);
        } catch {
          /* nada */
        }
        router.push(`/ordenes/certificacion/acta/${r.actaId}`);
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo firmar el acta"));
      }
    });
  };

  return (
    <div className="space-y-4">
      <Panel className="p-4 text-[13px] leading-relaxed text-texto-2">
        <b className="text-texto">
          {modalidad === "total" ? "Medición total" : `Muestreo: se mide al menos el ${MUESTREO_MINIMO_PCT}%`}
        </b>{" "}
        — {motivo}.{" "}
        {modalidad === "muestreo" &&
          "La muestra la sortea el sistema (sale siempre la misma para este día y esta empresa): son los marcados «SORTEADO». Se puede medir de más."}{" "}
        Los puntos medidos se certifican por lo medido; los demás, por lo informado.
      </Panel>

      {/* Filtro por orden: con trescientos puntos, se mide orden por orden. */}
      {ordenes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-texto-3">Orden:</span>
          <button
            type="button"
            onClick={() => setFiltroOrden(null)}
            className={`rounded-md px-2 py-1 font-semibold ${filtroOrden == null ? "bg-celeste/15 text-celeste" : "text-texto-2 hover:text-celeste"}`}
          >
            todas
          </button>
          {ordenes.map(([id, num]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltroOrden(id)}
              className={`num rounded-md px-2 py-1 font-semibold ${filtroOrden === id ? "bg-celeste/15 text-celeste" : "text-texto-2 hover:text-celeste"}`}
            >
              {num}
            </button>
          ))}
        </div>
      )}

      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
              <th className="px-3 py-2">Entra</th>
              <th className="px-3 py-2">Dónde</th>
              <th className="px-3 py-2">Fotos</th>
              <th className="px-3 py-2 text-right">Informado</th>
              <th className="px-3 py-2">Medido (ancho × largo, o m²)</th>
              <th className="px-3 py-2 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => {
              const entra = !fuera.has(p.itemId);
              const sorteado = entra && aMedir.has(p.itemId);
              const med = medidas[p.itemId] ?? { ancho: "", largo: "", m2: "" };
              const m2 = m2DeMedida(med);
              const dif = m2 != null && p.m2Informado > 0 ? ((m2 - p.m2Informado) / p.m2Informado) * 100 : null;
              const fotos: FotoVisor[] = p.fotos.map((f) => ({
                url: f.url,
                alt: `Foto ${ETIQUETA_MOMENTO[f.momento] ?? f.momento}`,
                etiqueta: `${(ETIQUETA_MOMENTO[f.momento] ?? f.momento).toUpperCase()} · ${p.direccion ?? ""}`,
                insignia: { texto: ETIQUETA_MOMENTO[f.momento] ?? f.momento, color: COLOR_MOMENTO[f.momento] ?? "#fff" },
              }));
              return (
                <tr key={p.itemId} className={`border-b border-borde/60 ${entra ? "" : "opacity-40"}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={entra}
                      onChange={() =>
                        setFuera((s) => {
                          const n = new Set(s);
                          if (n.has(p.itemId)) n.delete(p.itemId);
                          else n.add(p.itemId);
                          return n;
                        })
                      }
                      className="accent-[#2eb1ff]"
                      title={entra ? "Sacar este punto del acta (queda para la próxima)" : "Volver a ponerlo en el acta"}
                    />
                  </td>
                  <td className="max-w-64 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {p.lat != null && p.lon != null && (
                        <ChipMiniMapa lat={p.lat} lon={p.lon} etiqueta={p.direccion ?? `Item #${p.itemId}`} />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold" title={p.direccion ?? undefined}>
                          {p.direccion ?? "Sin dirección"}
                        </span>
                        <span className="num block text-[11px] text-texto-3">
                          {p.ordenNumero}
                          {p.reportadoEn && ` · ${fechaCorta(p.reportadoEn)}`}
                          {p.revisado && " · revisado ✓"}
                        </span>
                      </span>
                    </div>
                    {sorteado && modalidad === "muestreo" && (
                      <span className="mt-1 inline-block rounded bg-amarillo/15 px-1.5 py-0.5 text-[10px] font-bold text-amarillo">
                        SORTEADO — medir
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {fotos.length > 0 ? (
                      <GaleriaFotos fotos={fotos} miniAlto={48} miniAncho={64} className="flex gap-1" />
                    ) : (
                      <span className="text-xs text-texto-3">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right text-xs">
                    {p.anchoM != null && p.largoM != null && (
                      <span className="block text-texto-3">
                        {numero(p.anchoM)} × {numero(p.largoM)}
                      </span>
                    )}
                    <b>{numero(p.m2Informado)} m²</b>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 text-xs text-texto-3">
                      <input
                        value={med.ancho}
                        onChange={(e) => cambiar(p.itemId, "ancho", e.target.value)}
                        inputMode="decimal"
                        placeholder="ancho"
                        disabled={!entra}
                        className={claseInput}
                      />
                      ×
                      <input
                        value={med.largo}
                        onChange={(e) => cambiar(p.itemId, "largo", e.target.value)}
                        inputMode="decimal"
                        placeholder="largo"
                        disabled={!entra}
                        className={claseInput}
                      />
                      o
                      <input
                        value={med.m2}
                        onChange={(e) => cambiar(p.itemId, "m2", e.target.value)}
                        inputMode="decimal"
                        placeholder="m²"
                        disabled={!entra}
                        className={claseInput}
                      />
                      {m2 != null && <b className="num ml-1 text-texto">= {numero(m2)} m²</b>}
                    </div>
                  </td>
                  <td
                    className="num px-3 py-2 text-right text-xs font-semibold"
                    style={{
                      color:
                        dif == null
                          ? "var(--color-texto-3)"
                          : Math.abs(dif) > 5
                            ? "var(--color-sin-atencion)"
                            : "var(--color-hecho)",
                    }}
                  >
                    {dif == null ? "—" : `${dif > 0 ? "+" : ""}${dif.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* La cuenta y las firmas */}
      <Panel className="space-y-3 p-5">
        <p className="num text-sm">
          <b>{numero(incluidos.length)}</b> puntos en el acta · <b>{numero(medidos.length)}</b> medidos
          {faltan > 0 && <span className="text-amarillo"> · faltan {numero(faltan)} por medir</span>} ·{" "}
          {numero(Math.round(m2Informados * 10) / 10)} m² informados → <b>{numero(Math.round(m2Certificados * 10) / 10)} m²</b>{" "}
          a certificar
        </p>
        {medidos.length > 0 && (
          <p className="text-sm">
            Desviación entre lo informado y lo medido:{" "}
            <b style={{ color: desvio > 5 ? "var(--color-sin-atencion)" : "var(--color-hecho)" }}>{desvio.toFixed(1)}%</b>
            {desvio > 5 && (
              <span className="text-texto-2"> — pasa el 5%: la próxima acta de {empresa} vuelve a medición total.</span>
            )}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] text-texto-2">
            Firma del inspector (nombre y apellido)
            <input
              value={firmaInspector}
              onChange={(e) => setFirmaInspector(e.target.value)}
              className="mt-1 w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-[11px] text-texto-2">
            Firma por {empresa} (nombre y apellido)
            <input
              value={firmaContratista}
              onChange={(e) => setFirmaContratista(e.target.value)}
              placeholder="El representante que midió junto al inspector"
              className="mt-1 w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
            />
          </label>
        </div>
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Observaciones (opcional)"
          className="w-full resize-y rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
        />
        {error && <p className="text-sm text-peligro">{error}</p>}
        <button
          type="button"
          onClick={firmar}
          disabled={pendiente}
          className="flex items-center gap-2 rounded-xl bg-azul px-5 py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          <FileSignature size={16} /> {pendiente ? "Firmando…" : "Firmar el acta"}
        </button>
        <p className="text-[11px] text-texto-3">
          Al firmar, los puntos quedan certificados y ya no se corrigen ni se dan de baja. Después se imprime para
          las firmas en papel.
        </p>
      </Panel>
    </div>
  );
}
