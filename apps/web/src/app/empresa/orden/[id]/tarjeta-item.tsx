"use client";

import { Camera, Check, LocateFixed, MapPin, Mic, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { dentroDeSMT, type TipoIntervencion } from "@cimba/domain";
import { marcarYaResuelto, reportarItemHecho, reportarItemNoEncontrado } from "@/lib/acciones-ordenes";
import { comprimirFoto, pesoCorto } from "@/lib/comprimir-foto";
import { useDictadoVoz } from "@/lib/dictado";
import type { ItemOrden } from "@/lib/ordenes";
import { BarraConfianza, Panel } from "@/components/ui";
import { ChipMiniMapa, MiniMapa } from "@/components/mapa/mini-mapa";
import { mensajeDeError } from "@/lib/errores";
import {
  borradorTieneAlgo,
  borrarBorrador,
  guardarBorrador,
  guardarMemoria,
  leerBorrador,
  leerMemoria,
} from "./memoria-carga";

const ETIQUETA_TRABAJO: Record<string, string> = {
  bache: "Bache",
  carpeta: "Carpeta",
  tramo: "Tramo",
};

/** Los cuatro modos reales de resolver, con la etiqueta que usa la cuadrilla. */
const OPCIONES_INTERVENCION: Array<{ valor: TipoIntervencion; etiqueta: string }> = [
  { valor: "bacheo", etiqueta: "Bacheo" },
  { valor: "pano_hormigon", etiqueta: "Cambio de paño de hormigón" },
  { valor: "carpeta", etiqueta: "Carpeta (repavimentación)" },
  { valor: "enripiado", etiqueta: "Enripiado" },
];

/**
 * Modalidad de bacheo del protocolo de la DOV: es el dato con el que se
 * certifica el pago. "Extendido" no es una opinión — el protocolo lo define
 * por encima de 4 m², así que se preselecciona sola con la medida cargada.
 */
const OPCIONES_OBRA: Array<{ valor: string; etiqueta: string }> = [
  { valor: "planificado", etiqueta: "Planificado" },
  { valor: "provisorio", etiqueta: "Provisorio (urgencia)" },
  { valor: "extendido", etiqueta: "Extendido (+4 m²)" },
  { valor: "sobre_adoquin", etiqueta: "Sobre adoquín" },
];

/** El teclado del teléfono mete coma decimal: se normaliza antes de parsear. */
const aNumero = (s: string) => Number(s.trim().replace(",", "."));

/**
 * Medidas por VOZ: "ancho dos, largo tres y medio, espesor cinco" o el más
 * criollo "dos por tres por cinco" (ancho × largo × espesor). El dictado solo
 * PROPONE: llena los campos y el capataz confirma — nunca envía solo.
 */
function parsearMedidas(fraseCruda: string): { ancho?: string; largo?: string; espesor?: string } {
  // Los reconocedores suelen devolver dígitos, pero por las dudas se traducen
  // las palabras más comunes y los decimales hablados ("dos coma cinco").
  let f = " " + fraseCruda.toLowerCase() + " ";
  const PALABRAS: Array<[RegExp, string]> = [
    [/ un[oa]? /g, " 1 "], [/ dos /g, " 2 "], [/ tres /g, " 3 "], [/ cuatro /g, " 4 "],
    [/ cinco /g, " 5 "], [/ seis /g, " 6 "], [/ siete /g, " 7 "], [/ ocho /g, " 8 "],
    [/ nueve /g, " 9 "], [/ diez /g, " 10 "], [/ medio metro /g, " 0.5 "],
  ];
  for (const [re, v] of PALABRAS) f = f.replace(re, v);
  f = f
    .replace(/(d)s*(?:coma|con|punto)s*(d)/g, "$1.$2")
    .replace(/(d)s*y medio/g, "$1.5")
    .replace(/,/g, ".");

  const buscar = (claves: string) => {
    const m = new RegExp("(?:" + claves + ")[^0-9]{0,12}([0-9]+(?:\\.[0-9]+)?)").exec(f);
    return m?.[1];
  };
  const r: { ancho?: string; largo?: string; espesor?: string } = {
    ancho: buscar("ancho"),
    largo: buscar("largo|alto"),
    espesor: buscar("espesor|grosor|profundidad"),
  };

  // Sin palabras clave: "2 por 3 por 5" (o "2 x 3 x 5") en el orden de la
  // planilla de siempre — ancho, largo, espesor.
  if (!r.ancho && !r.largo && !r.espesor) {
    const porM = /([0-9]+(?:.[0-9]+)?)s*(?:por|x)s*([0-9]+(?:.[0-9]+)?)(?:s*(?:por|x)s*([0-9]+(?:.[0-9]+)?))?/.exec(f);
    if (porM) {
      r.ancho = porM[1];
      r.largo = porM[2];
      if (porM[3]) r.espesor = porM[3];
    }
  }
  return r;
}

/** Mismo bounding box que valida la acción: mejor avisar acá que con un error zod críptico. */
const dentroDeSmt = (lat: number, lon: number) =>
  lat >= -27.2 && lat <= -26.5 && lon >= -65.6 && lon <= -64.9;

interface Ubicacion {
  lat: number;
  lon: number;
  /** Lo que dijo/escribió el capataz: viaja como direccionCorregida. */
  direccion?: string;
  origen: "orden" | "geocoder" | "gps";
  detalle: string;
  precisionM?: number;
}

/**
 * Punto candidato (geocodificado o GPS) todavía sin confirmar: se muestra en
 * el mini-mapa con el pin arrastrable para que el capataz lo afine ANTES de
 * aceptarlo — el punto final ajustado es el que viaja en el FormData.
 */
interface Candidato {
  lat: number;
  lon: number;
  origen: "geocoder" | "gps";
  /** Geocoder: lo que devolvió, para confirmar que es SU esquina. */
  resuelta?: string;
  /** Geocoder: lo que dictó/escribió él, que es lo que se guarda. */
  texto?: string;
  confianza?: number;
  precisionM?: number;
  /** Movió el pin a mano: el punto ya es del capataz, no del geocoder/GPS. */
  ajustado?: boolean;
}

/**
 * Un bache pendiente de la orden, con el formulario de reporte adentro.
 * Pensado para el capataz con guantes: targets grandes, un solo camino feliz,
 * y la ubicación se resuelve dictando, escribiendo o con el GPS del teléfono.
 */
export function TarjetaItem({ item, ordenId }: { item: ItemOrden; ordenId: number }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // medidas
  const [ancho, setAncho] = useState("");
  const [largo, setLargo] = useState("");
  const [espesor, setEspesor] = useState("");
  const [obs, setObs] = useState("");
  // Quién carga y contra qué reclamo: ver el bloque del formulario.
  const [capataz, setCapataz] = useState("");
  const [ticket, setTicket] = useState("");
  // Cómo se resolvió: arranca en lo que pedía la orden (carpeta → carpeta,
  // el resto → bacheo) y el capataz lo corrige si en la calle terminó siendo
  // otra cosa ("empieza como bacheo y al final se ha hecho cambio de paño").
  const [tipoIntervencion, setTipoIntervencion] = useState<TipoIntervencion>(
    item.tipoTrabajo === "carpeta" ? "carpeta" : "bacheo",
  );

  // Modalidad del protocolo: null = seguir la sugerencia automática por medida.
  const [tipoObra, setTipoObra] = useState<string | null>(null);

  // "ya estaba hecho": mini-form aparte, con su propia foto obligatoria
  const [yaAbierto, setYaAbierto] = useState(false);
  const refFotoHoy = useRef<HTMLInputElement>(null);
  const [fotoHoy, setFotoHoy] = useState<File | null>(null);
  const [previewHoy, setPreviewHoy] = useState<string | null>(null);
  const [obsYa, setObsYa] = useState("");

  // fotos
  const refDespues = useRef<HTMLInputElement>(null);
  const refAntes = useRef<HTMLInputElement>(null);
  const [fotoDespues, setFotoDespues] = useState<File | null>(null);
  const [fotoAntes, setFotoAntes] = useState<File | null>(null);
  const [previewDespues, setPreviewDespues] = useState<string | null>(null);
  const [previewAntes, setPreviewAntes] = useState<string | null>(null);

  // ubicación
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(
    item.lat != null && item.lon != null
      ? { lat: item.lat, lon: item.lon, origen: "orden", detalle: "Ubicación de la orden" }
      : null,
  );
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [direccionTexto, setDireccionTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [errorGeo, setErrorGeo] = useState<string | null>(null);
  const [candidato, setCandidato] = useState<Candidato | null>(null);

  /**
   * Lo que el teléfono ya sabía. Dos rescates, en este orden de prioridad:
   * primero el BORRADOR de este bache (si se cortó la señal a mitad de la
   * carga, lo tipeado vuelve tal cual y se avisa), y si no hay borrador, los
   * valores que se repiten toda la jornada (espesor y modalidad) de la última
   * carga de ESTA orden. Nada se manda solo: quedan escritos en los campos y
   * el capataz confirma como siempre.
   */
  const [rescatado, setRescatado] = useState(false);
  const [deMemoria, setDeMemoria] = useState(false);
  useEffect(() => {
    const b = leerBorrador(item.id);
    if (b && borradorTieneAlgo(b)) {
      if (b.ancho) setAncho(b.ancho);
      if (b.largo) setLargo(b.largo);
      if (b.espesor) setEspesor(b.espesor);
      if (b.obs) setObs(b.obs);
      setRescatado(true);
      setAbierto(true);
      return;
    }
    const m = leerMemoria(ordenId);
    if (m.espesor) {
      setEspesor(m.espesor);
      setDeMemoria(true);
    }
    if (m.tipoIntervencion) setTipoIntervencion(m.tipoIntervencion as TipoIntervencion);
    if (m.tipoObra !== undefined) setTipoObra(m.tipoObra);
    // El capataz es el mismo toda la jornada: se escribe una vez.
    if (m.capataz) setCapataz(m.capataz);
    // Una sola vez por tarjeta, al montar: después manda lo que tipea el capataz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Guardado continuo del borrador: cada tecla, sin botón de "guardar". */
  useEffect(() => {
    const b = { ancho, largo, espesor, obs };
    if (borradorTieneAlgo(b)) guardarBorrador(item.id, b);
  }, [ancho, largo, espesor, obs, item.id]);

  const buscarDireccion = async (texto: string) => {
    const q = texto.trim();
    if (q.length < 4) {
      setErrorGeo("Escribí la dirección un poco más completa (calle y altura).");
      return;
    }
    setBuscando(true);
    setErrorGeo(null);
    setCandidato(null);
    try {
      const res = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as {
        resultado: {
          punto: { lat: number; lon: number };
          confianza: number;
          direccionResuelta: string | null;
        } | null;
      };
      if (!data.resultado) {
        setErrorGeo("No se encontró esa dirección: probá con calle y altura, sin barrio.");
        return;
      }
      setCandidato({
        lat: data.resultado.punto.lat,
        lon: data.resultado.punto.lon,
        origen: "geocoder",
        confianza: data.resultado.confianza,
        resuelta: data.resultado.direccionResuelta ?? q,
        texto: q,
      });
    } catch {
      setErrorGeo("Falló la búsqueda: fijate la señal y probá de nuevo.");
    } finally {
      setBuscando(false);
    }
  };

  const dictado = useDictadoVoz((frase) => {
    setDireccionTexto(frase);
    void buscarDireccion(frase);
  });

  // Medidas por voz: llena lo que entendió y muestra qué entendió; el envío
  // sigue siendo el botón de siempre — "requiere solo confirmación después".
  const [oidoMedidas, setOidoMedidas] = useState<string | null>(null);
  const dictadoMedidas = useDictadoVoz((frase) => {
    const m = parsearMedidas(frase);
    if (m.ancho) setAncho(m.ancho);
    if (m.largo) setLargo(m.largo);
    if (m.espesor) setEspesor(m.espesor);
    setOidoMedidas(
      m.ancho || m.largo || m.espesor
        ? `Entendí: «${frase}» — revisá los números y confirmá.`
        : `No entendí medidas en «${frase}». Probá: "ancho 2, largo 3, espesor 5" o "2 por 3 por 5".`,
    );
  });

  const usarGps = () => {
    if (!navigator.geolocation) {
      setErrorGeo("Este teléfono no expone el GPS al navegador.");
      return;
    }
    setBuscandoGps(true);
    setErrorGeo(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoGps(false);
        const { latitude, longitude, accuracy } = pos.coords;
        if (!dentroDeSmt(latitude, longitude)) {
          setErrorGeo("El GPS te ubica fuera de San Miguel de Tucumán: probá de nuevo al lado del bache.");
          return;
        }
        // No se acepta directo: queda como candidato en el mini-mapa para
        // que el capataz lo afine (el GPS urbano suele pifiar unos metros).
        setCandidato({
          lat: latitude,
          lon: longitude,
          origen: "gps",
          precisionM: Math.round(accuracy),
        });
      },
      () => {
        setBuscandoGps(false);
        setErrorGeo("No se pudo leer el GPS: activá la ubicación del teléfono y dale permiso al navegador.");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  /**
   * La foto se achica ANTES de entrar al formulario: ver comprimir-foto.ts —
   * las dos fotos de un celular moderno no entran en el límite de body de la
   * función serverless, así que sin esto el reporte falla recién al enviar.
   * El contador permite bloquear el envío mientras se está recodificando.
   */
  const [preparandoFotos, setPreparandoFotos] = useState(0);
  /**
   * Qué cuadro está ocupado. El CONTADOR de arriba no alcanza y no se
   * reemplaza: es el que bloquea el envío de una foto sin comprimir contra el
   * límite de body de la función serverless. Esto es otra cosa — dónde mira el
   * capataz mientras espera. Sacaba la foto, volvía al formulario y el cuadro
   * decía exactamente lo mismo que antes ("Foto del DESPUÉS / obligatoria"),
   * así que con guantes y el camión esperando tocaba de nuevo y se abría la
   * cámara otra vez.
   */
  const [cuadroOcupado, setCuadroOcupado] = useState<Record<string, boolean>>({});
  const [ahorroFoto, setAhorroFoto] = useState<string | null>(null);
  const elegirFoto = async (
    clave: string,
    archivo: File | undefined,
    setFoto: (f: File | null) => void,
    setPreview: (u: string | null) => void,
    previewAnterior: string | null,
  ) => {
    if (previewAnterior) URL.revokeObjectURL(previewAnterior);
    if (!archivo) {
      setFoto(null);
      setPreview(null);
      return;
    }
    setPreparandoFotos((n) => n + 1);
    setCuadroOcupado((v) => ({ ...v, [clave]: true }));
    try {
      const { archivo: listo, antes, despues } = await comprimirFoto(archivo);
      setFoto(listo);
      setPreview(URL.createObjectURL(listo));
      if (despues < antes) setAhorroFoto(`${pesoCorto(antes)} → ${pesoCorto(despues)}`);
    } finally {
      setPreparandoFotos((n) => n - 1);
      setCuadroOcupado((v) => ({ ...v, [clave]: false }));
    }
  };

  const anchoN = aNumero(ancho);
  const largoN = aNumero(largo);
  const superficie = anchoN > 0 && largoN > 0 ? anchoN * largoN : null;
  const espesorN = aNumero(espesor);
  // El volumen de mezcla en vivo (el espesor viene en cm): le dice al capataz
  // cuánto material se llevó el paño, no solo cuánta superficie tapó.
  const volumen = superficie != null && espesorN > 0 ? (superficie * espesorN) / 100 : null;

  const enviar = () => {
    setError(null);
    if (!(anchoN > 0) || !(largoN > 0) || !(aNumero(espesor) > 0)) {
      setError("Cargá el ancho, el largo y el espesor.");
      return;
    }
    if (!fotoDespues) {
      setError("Falta la foto del trabajo terminado (es obligatoria).");
      return;
    }
    if (!ubicacion) {
      setError("Falta la ubicación: dictá la dirección, escribila o usá tu GPS.");
      return;
    }

    const fd = new FormData();
    fd.set("itemId", String(item.id));
    fd.set("anchoM", String(anchoN));
    fd.set("largoM", String(largoN));
    fd.set("espesorCm", String(aNumero(espesor)));
    fd.set("tipoIntervencion", tipoIntervencion);
    if (tipoObra) fd.set("tipoObra", tipoObra);
    if (obs.trim()) fd.set("observaciones", obs.trim());
    if (capataz.trim()) fd.set("capataz", capataz.trim());
    if (ticket.trim()) fd.set("ticket147", ticket.trim());
    // Solo se manda ubicación si es una corrección: si es la de la orden,
    // la acción ya la toma del propio item.
    if (ubicacion.origen !== "orden") {
      fd.set("lat", String(ubicacion.lat));
      fd.set("lon", String(ubicacion.lon));
      if (ubicacion.direccion) fd.set("direccionCorregida", ubicacion.direccion);
    }
    fd.set("foto", fotoDespues);
    if (fotoAntes) fd.set("fotoAntes", fotoAntes);

    startTransition(async () => {
      try {
        await reportarItemHecho(fd);
        // Recién acá, con el reporte aceptado por el servidor: se tira el
        // borrador (ya no hay nada que rescatar) y se recuerda lo que se
        // repite para el bache siguiente de la misma orden.
        borrarBorrador(item.id);
        guardarMemoria(ordenId, { espesor, tipoIntervencion, tipoObra, capataz: capataz.trim() || undefined });
        // al refrescar, el server component mueve este item a la lista de hechos
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo reportar: probá de nuevo."));
      }
    });
  };

  /**
   * Motivo inline y no window.prompt(): el diálogo nativo no anda en webviews
   * embebidos, corta el flujo táctil, y con guantes es imposible — el input
   * grande con confirmar es el mismo patrón del resto de la tarjeta.
   */
  const [noEncAbierto, setNoEncAbierto] = useState(false);
  const [motivoNoEnc, setMotivoNoEnc] = useState("");
  const enviarNoEncontrado = () => {
    if (motivoNoEnc.trim().length < 3) {
      setError("Contá en una frase por qué no se encontró (ej.: ya estaba tapado, la dirección no existe).");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await reportarItemNoEncontrado({ itemId: item.id, motivo: motivoNoEnc.trim() });
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo reportar: probá de nuevo."));
      }
    });
  };

  const enviarYaResuelto = () => {
    setError(null);
    if (!fotoHoy) {
      setError("Sacale una foto a cómo está hoy: es la evidencia de que ya estaba hecho.");
      return;
    }
    const fd = new FormData();
    fd.set("itemId", String(item.id));
    fd.set("foto", fotoHoy);
    if (obsYa.trim()) fd.set("observaciones", obsYa.trim());
    startTransition(async () => {
      try {
        await marcarYaResuelto(fd);
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo reportar: probá de nuevo."));
      }
    });
  };

  const mostrarPicker = ubicacion == null || corrigiendo;

  return (
    <Panel className="p-4">
      <p className="text-lg leading-snug font-bold">{item.direccion ?? "Sin dirección"}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded bg-panel-3 px-2 py-1 text-[11px] font-bold text-texto-2 uppercase">
          {ETIQUETA_TRABAJO[item.tipoTrabajo] ?? item.tipoTrabajo}
        </span>
        {item.reclamos > 0 && (
          <span className="rounded bg-amarillo/15 px-2 py-1 text-[11px] font-bold text-amarillo">
            {item.reclamos === 1 ? "1 reclamo detrás" : `${item.reclamos} reclamos detrás`}
          </span>
        )}
        {ubicacion && (
          /* Que el capataz verifique a qué esquina ir antes de salir.
             Sin "Mapa completo": el rol empresa no entra a /mapa. */
          <ChipMiniMapa
            lat={ubicacion.lat}
            lon={ubicacion.lon}
            etiqueta={item.direccion ?? "Ubicación del trabajo"}
            texto="Ver en el mapa"
            conMapaCompleto={false}
          />
        )}
      </div>

      {error && <p className="mt-2 text-sm font-medium text-peligro">{error}</p>}

      {/* Que se note que el teléfono devolvió algo: un campo que aparece lleno
          sin explicación se envía sin mirar, y acá lo que se envía se certifica. */}
      {rescatado && (
        <div className="mt-2 rounded-lg border border-amarillo/40 bg-amarillo/10 px-3 py-2 text-[12px] leading-snug">
          <b className="text-amarillo">Recuperado de este teléfono:</b> habías empezado a cargar este
          bache y quedó a medias. Revisá las medidas antes de enviar — las fotos hay que sacarlas de
          nuevo.{" "}
          <button
            type="button"
            onClick={() => {
              setAncho("");
              setLargo("");
              setEspesor("");
              setObs("");
              borrarBorrador(item.id);
              setRescatado(false);
            }}
            className="font-semibold text-celeste underline"
          >
            Empezar de cero
          </button>
        </div>
      )}
      {deMemoria && !rescatado && (
        <p className="mt-2 text-[12px] leading-snug text-texto-3">
          Espesor y modalidad vienen puestos de tu carga anterior en esta orden. Cambialos si este
          bache fue distinto.
        </p>
      )}

      {!abierto ? (
        <div className="mt-3 space-y-2">
          <button
            onClick={() => {
              setAbierto(true);
              setYaAbierto(false);
            }}
            className="w-full rounded-xl bg-azul px-4 py-4 text-base font-bold text-white transition active:scale-[0.99]"
          >
            REPORTAR HECHO
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setYaAbierto((v) => !v)}
              disabled={pendiente}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                yaAbierto
                  ? "border-celeste/60 bg-celeste/10 text-celeste"
                  : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
              }`}
            >
              Ya estaba hecho
            </button>
            <button
              onClick={() => setNoEncAbierto((v) => !v)}
              disabled={pendiente}
              className={`rounded-lg px-3 py-2 text-sm transition disabled:opacity-50 ${
                noEncAbierto ? "text-texto" : "text-texto-3 hover:text-texto-2"
              }`}
            >
              No lo encontré
            </button>
          </div>

          {noEncAbierto && (
            <div className="space-y-2 rounded-xl border border-borde-2 bg-panel-2 p-3">
              <input
                value={motivoNoEnc}
                onChange={(e) => setMotivoNoEnc(e.target.value)}
                placeholder="¿Por qué? Ej.: ya estaba tapado, la dirección no existe"
                className="w-full rounded-lg border border-borde-2 bg-panel px-3 py-3 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
              />
              <button
                onClick={enviarNoEncontrado}
                disabled={pendiente || motivoNoEnc.trim().length < 3}
                className="w-full rounded-lg border border-borde-2 px-3 py-3 text-sm font-semibold text-texto-2 transition hover:text-texto disabled:opacity-50"
              >
                {pendiente ? "Enviando…" : "Confirmar: no se encontró"}
              </button>
            </div>
          )}

          {/* "Llegamos y ya estaba tapado": evidencia de hoy, sin sumar m². */}
          {yaAbierto && (
            <div className="space-y-2 rounded-xl border border-celeste/40 bg-celeste/5 p-3">
              <p className="text-sm leading-relaxed text-texto-2">
                Si al llegar el bache ya estaba reparado, sacale una foto de cómo está hoy. No suma
                m² de tu empresa: solo cierra el punto con evidencia.
              </p>
              <input
                ref={refFotoHoy}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void elegirFoto("hoy", e.target.files?.[0], setFotoHoy, setPreviewHoy, previewHoy)}
              />
              <button
                onClick={() => refFotoHoy.current?.click()}
                disabled={cuadroOcupado.hoy}
                className={`relative h-28 w-full overflow-hidden rounded-xl border-2 transition ${
                  fotoHoy ? "border-celeste/60" : "border-dashed border-borde-2 hover:border-celeste/60"
                }`}
              >
                <Achicando visible={cuadroOcupado.hoy} />
                {previewHoy ? (
                  <>
                    <img src={previewHoy} alt="Foto de cómo está hoy" loading="lazy" className="h-full w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                      CÓMO ESTÁ HOY ✓ — tocá para cambiar
                    </span>
                  </>
                ) : (
                  <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                    <Camera size={22} className="text-celeste" />
                    Foto de cómo está hoy
                    <span className="text-[10px] font-medium text-texto-3">obligatoria</span>
                  </span>
                )}
              </button>
              <textarea
                value={obsYa}
                onChange={(e) => setObsYa(e.target.value)}
                rows={2}
                placeholder="Observaciones (opcional): quién lo habrá tapado, cómo quedó…"
                className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:text-texto-3"
              />
              <button
                onClick={enviarYaResuelto}
                disabled={pendiente || preparandoFotos > 0}
                className="w-full rounded-xl bg-celeste px-4 py-3.5 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-50"
              >
                {preparandoFotos > 0
                  ? "Preparando la foto…"
                  : pendiente
                    ? "Subiendo foto…"
                    : "CONFIRMAR: YA ESTABA HECHO"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Medidas reales */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wider text-texto-3 uppercase">Medidas reales</span>
              <button
                type="button"
                onClick={dictadoMedidas.alternar}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  dictadoMedidas.escuchando
                    ? "border-peligro text-peligro"
                    : "border-borde-2 text-celeste hover:border-celeste"
                }`}
                title='Decí las tres medidas de corrido: "ancho 2, largo 3, espesor 5" o "2 por 3 por 5"'
              >
                🎤 {dictadoMedidas.escuchando ? "Escuchando…" : "Dictar medidas"}
              </button>
            </div>
            {oidoMedidas && <p className="mb-1.5 text-[11px] text-texto-2">{oidoMedidas}</p>}
            {dictadoMedidas.error && <p className="mb-1.5 text-[11px] text-peligro">{dictadoMedidas.error}</p>}
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-texto-2">Ancho (m)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  value={ancho}
                  onChange={(e) => setAncho(e.target.value)}
                  className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-texto-2">Largo (m)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  value={largo}
                  onChange={(e) => setLargo(e.target.value)}
                  className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-texto-2">Espesor (cm)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  value={espesor}
                  onChange={(e) => setEspesor(e.target.value)}
                  className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
                />
              </label>
            </div>
            {superficie != null && (
              <p className="num mt-2 text-xl font-extrabold text-celeste">
                = {superficie.toLocaleString("es-AR", { maximumFractionDigits: 2 })} m²
                {volumen != null && (
                  <span className="text-texto-2">
                    {" "}· {volumen.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³
                  </span>
                )}
              </p>
            )}
            <p className="mt-1 text-xs leading-relaxed text-texto-3">
              Medí lo que realmente pavimentaste: a veces es un bache pero se hace el paño entero.
            </p>
          </div>

          {/* Qué se hizo al final: pills grandes (guantes), no un select chico */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-texto-2">¿Qué trabajo se hizo?</p>
            <div className="grid grid-cols-2 gap-2">
              {OPCIONES_INTERVENCION.map((op) => (
                <button
                  key={op.valor}
                  type="button"
                  onClick={() => setTipoIntervencion(op.valor)}
                  className={`min-h-14 rounded-xl border-2 px-3 py-2.5 text-sm leading-snug font-bold transition active:scale-[0.99] ${
                    tipoIntervencion === op.valor
                      ? "border-azul bg-azul/15 text-celeste"
                      : "border-borde-2 bg-panel-2 text-texto-2 hover:border-celeste/60"
                  }`}
                >
                  {op.etiqueta}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-texto-3">
              Si empezó como bacheo pero terminaron cambiando el paño, marcá lo que realmente se hizo.
            </p>
          </div>

          {/* Modalidad del protocolo: es lo que se certifica para el pago */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-texto-2">¿Bajo qué modalidad?</p>
            <div className="grid grid-cols-2 gap-2">
              {OPCIONES_OBRA.map((op) => {
                // Sin elección explícita se muestra marcada la que corresponde
                // por medida, que es la que va a viajar igual.
                const sugerida = superficie != null && superficie > 4 ? "extendido" : "planificado";
                const activa = (tipoObra ?? sugerida) === op.valor;
                return (
                  <button
                    key={op.valor}
                    type="button"
                    onClick={() => setTipoObra(op.valor)}
                    className={`min-h-12 rounded-xl border-2 px-3 py-2 text-[13px] leading-snug font-bold transition active:scale-[0.99] ${
                      activa
                        ? "border-azul bg-azul/15 text-celeste"
                        : "border-borde-2 bg-panel-2 text-texto-2 hover:border-celeste/60"
                    }`}
                  >
                    {op.etiqueta}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-texto-3">
              Provisorio es el arreglo de urgencia que después hay que rehacer. Con más de 4 m² el protocolo
              lo cuenta como extendido.
            </p>
          </div>

          {/* Fotos: el después manda */}
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={refDespues}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) =>
                void elegirFoto("despues", e.target.files?.[0], setFotoDespues, setPreviewDespues, previewDespues)
              }
            />
            <input
              ref={refAntes}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void elegirFoto("antes", e.target.files?.[0], setFotoAntes, setPreviewAntes, previewAntes)}
            />
            <button
              onClick={() => refDespues.current?.click()}
              disabled={cuadroOcupado.despues}
              className={`relative h-28 overflow-hidden rounded-xl border-2 transition ${
                fotoDespues ? "border-resuelto/60" : "border-dashed border-borde-2 hover:border-resuelto/60"
              }`}
            >
              <Achicando visible={cuadroOcupado.despues} />
              {previewDespues ? (
                <>
                  <img src={previewDespues} alt="Foto del después" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                    DESPUÉS ✓ — tocá para cambiar
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                  <Camera size={22} className="text-resuelto" />
                  Foto del DESPUÉS
                  <span className="text-[10px] font-medium text-texto-3">obligatoria</span>
                </span>
              )}
            </button>
            <button
              onClick={() => refAntes.current?.click()}
              disabled={cuadroOcupado.antes}
              className={`relative h-28 overflow-hidden rounded-xl border-2 transition ${
                fotoAntes ? "border-celeste/60" : "border-dashed border-borde-2 hover:border-celeste/60"
              }`}
            >
              <Achicando visible={cuadroOcupado.antes} />
              {previewAntes ? (
                <>
                  <img src={previewAntes} alt="Foto del antes" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                    ANTES ✓ — tocá para cambiar
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                  <Camera size={22} className="text-celeste" />
                  Foto del ANTES
                  <span className="text-[10px] font-medium text-texto-3">opcional</span>
                </span>
              )}
            </button>
          </div>

          {/* Ubicación */}
          {!mostrarPicker && ubicacion && (
            <div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-resuelto/40 bg-resuelto/10 px-3 py-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Check size={16} className="shrink-0 text-resuelto" />
                  {ubicacion.detalle} ✓
                </span>
                <button
                  onClick={() => setCorrigiendo(true)}
                  className="shrink-0 rounded-lg border border-borde-2 px-3 py-2 text-xs font-semibold text-texto-2 transition hover:border-amarillo/60 hover:text-amarillo"
                >
                  Corregir ubicación
                </button>
              </div>
              {ubicacion.precisionM != null && ubicacion.precisionM > 30 && (
                <p className="mt-1 text-xs text-amarillo">
                  La precisión del GPS es baja (±{ubicacion.precisionM} m): si podés, esperá unos
                  segundos al lado del bache y volvé a tomarla.
                </p>
              )}
            </div>
          )}

          {mostrarPicker && (
            <div className="space-y-2 rounded-xl border border-amarillo/40 bg-amarillo/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-bold text-amarillo">
                  <MapPin size={15} />
                  {ubicacion ? "Corregir la ubicación" : "Falta la ubicación del trabajo"}
                </p>
                {ubicacion && (
                  <button
                    onClick={() => {
                      setCorrigiendo(false);
                      setCandidato(null);
                      setErrorGeo(null);
                      dictado.limpiarError();
                    }}
                    className="text-xs text-texto-3 hover:text-texto"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              <input
                value={direccionTexto}
                onChange={(e) => setDireccionTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void buscarDireccion(direccionTexto);
                }}
                placeholder={dictado.escuchando ? "Escuchando… decí la dirección" : "Calle y altura, ej: Las Piedras 1500"}
                className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-base placeholder:text-texto-3"
              />

              <div className="grid grid-cols-3 gap-2">
                {dictado.hayVoz && (
                  <button
                    onClick={() => {
                      dictado.limpiarError();
                      dictado.alternar();
                    }}
                    className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-bold transition ${
                      dictado.escuchando
                        ? "animate-pulse border-peligro/60 bg-peligro/15 text-peligro"
                        : "border-borde-2 bg-panel-2 hover:border-celeste"
                    }`}
                  >
                    <Mic size={20} className={dictado.escuchando ? "" : "text-celeste"} />
                    {dictado.escuchando ? "Escuchando…" : "Dictar"}
                  </button>
                )}
                <button
                  onClick={() => void buscarDireccion(direccionTexto)}
                  disabled={buscando}
                  className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-borde-2 bg-panel-2 text-xs font-bold transition hover:border-celeste disabled:opacity-50"
                >
                  <Search size={20} className="text-celeste" />
                  {buscando ? "Buscando…" : "Ubicar"}
                </button>
                <button
                  onClick={usarGps}
                  disabled={buscandoGps}
                  className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-borde-2 bg-panel-2 text-xs font-bold transition hover:border-celeste disabled:opacity-50 ${
                    dictado.hayVoz ? "" : "col-span-2"
                  }`}
                >
                  <LocateFixed size={20} className="text-celeste" />
                  {buscandoGps ? "Leyendo GPS…" : "Usar mi GPS"}
                </button>
              </div>

              {(errorGeo || dictado.error) && (
                <p className="text-xs leading-relaxed text-peligro">{errorGeo ?? dictado.error}</p>
              )}

              {candidato && (
                <div className="rounded-lg border border-borde-2 bg-panel-2 p-3">
                  <p className="text-sm leading-snug">
                    {candidato.origen === "gps"
                      ? `Tu GPS (±${candidato.precisionM ?? "?"} m)`
                      : candidato.resuelta}
                  </p>
                  {/* El pin se afina a mano ANTES de confirmar: el geocoder le
                      pifia media cuadra seguido y el GPS urbano rebota entre
                      edificios. El punto ajustado es el que va al FormData. */}
                  <div className="mt-2">
                    <MiniMapa
                      lat={candidato.lat}
                      lon={candidato.lon}
                      etiqueta={candidato.resuelta ?? item.direccion}
                      alto={200}
                      alMover={({ lat, lon }) =>
                        setCandidato((c) => (c ? { ...c, lat, lon, ajustado: true } : c))
                      }
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {candidato.origen === "geocoder" && candidato.confianza != null ? (
                      <BarraConfianza valor={candidato.confianza} />
                    ) : (
                      <span />
                    )}
                    <button
                      onClick={() => {
                        const c = candidato;
                        // El pin arrastrado puede terminar en cualquier lado:
                        // la frontera operativa real (la misma del server) se
                        // chequea acá, con mensaje claro en vez de un error al
                        // final del formulario.
                        if (!dentroDeSMT({ lat: c.lat, lon: c.lon })) {
                          setErrorGeo("El pin quedó fuera de San Miguel de Tucumán: acercalo al bache");
                          return;
                        }
                        setErrorGeo(null);
                        setUbicacion({
                          lat: c.lat,
                          lon: c.lon,
                          direccion: c.texto,
                          origen: c.origen,
                          detalle: c.ajustado
                            ? `${c.texto ?? "Pin"} — ajustado en el mapa`
                            : c.origen === "gps"
                              ? `Tu GPS (±${c.precisionM ?? "?"} m)`
                              : (c.texto ?? "Dirección geocodificada"),
                          // Si movió el pin a mano, la precisión del GPS ya no
                          // describe el punto: no corresponde la advertencia.
                          precisionM: c.ajustado ? undefined : c.precisionM,
                        });
                        setCorrigiendo(false);
                        setCandidato(null);
                        setErrorGeo(null);
                      }}
                      className="rounded-lg bg-azul px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                    >
                      Usar esta ✓
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quién y contra qué reclamo: dos datos que hoy se pierden.
              El capataz, porque la clave del portal es UNA por empresa y sin
              esto todo queda firmado "INGECO S.A."; el ticket, porque es la
              única forma de cerrarle al vecino sin adivinar por cercanía. */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-texto-2">Capataz</span>
              <input
                value={capataz}
                onChange={(e) => setCapataz(e.target.value)}
                placeholder="Tu nombre"
                className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:text-texto-3"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-texto-2">N° de ticket 147</span>
              <input
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                inputMode="numeric"
                placeholder="si lo tenés"
                className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:font-sans placeholder:text-texto-3"
              />
            </label>
          </div>

          {/* Observaciones */}
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Observaciones (opcional)"
            className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:text-texto-3"
          />

          <button
            onClick={enviar}
            disabled={pendiente || preparandoFotos > 0}
            className="w-full rounded-xl bg-resuelto px-4 py-4 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-50"
          >
            {preparandoFotos > 0
              ? "Preparando la foto…"
              : pendiente
                ? "Subiendo foto…"
                : "CONFIRMAR TRABAJO HECHO"}
          </button>
          {ahorroFoto && (
            <p className="num text-center text-[11px] text-texto-3">
              Foto achicada para que suba rápido: {ahorroFoto}
            </p>
          )}
          <button
            onClick={() => setAbierto(false)}
            disabled={pendiente}
            className="w-full rounded-lg px-3 py-2 text-sm text-texto-3 transition hover:text-texto-2 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      )}
    </Panel>
  );
}

/**
 * "Estoy achicando la foto", encima del cuadro donde el capataz está mirando.
 *
 * Es la espera más larga del portal (recodificar 8 MP en un teléfono de
 * gama media) y era la única sin aviso: el cuadro seguía diciendo "Foto del
 * DESPUÉS / obligatoria" como si la cámara no hubiera guardado nada.
 *
 * Fondo negro neutro a propósito: ni semáforo ni amarillo de marca — no es un
 * estado del trabajo, es el sistema trabajando. Y el texto es EXACTAMENTE el
 * mismo que muestra el botón de enviar mientras dura, para que no parezcan
 * dos esperas distintas.
 */
export function Achicando({ visible }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <span className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-[11px] font-bold text-white">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      Preparando la foto…
    </span>
  );
}
