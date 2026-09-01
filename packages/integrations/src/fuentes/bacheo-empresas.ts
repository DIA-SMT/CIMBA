import { z } from "zod";
import type { DemandaNormalizada, IntervencionNormalizada, TipoProblema } from "@cimba/domain";
import {
  demandaNormalizadaSchema,
  intervencionNormalizadaSchema,
  normalizarDireccion,
} from "@cimba/domain";
import { limpiarTexto } from "../archivos/util";

/**
 * Baches que cargan las empresas contratistas (Ingeco, Calleri, UOCRA, Elías
 * Maza) desde la app de Google Apps Script de la Dirección de Bacheo.
 *
 * La app no expone una API declarada, pero su front habla con el backend por el
 * RPC interno de google.script.run, y ese canal responde sin autenticación: se
 * invoca `getPuntos` con un POST y devuelve la planilla entera. Verificado el
 * 01/09/2026 (1.038 registros, 694 KB).
 *
 * De cada fila sale UNA de dos cosas, y la distinción importa para que la
 * brecha no mienta:
 *  - con superficie cargada → INTERVENCIÓN: la cuadrilla reparó y midió.
 *  - sin superficie → DEMANDA: la cuadrilla DETECTÓ un problema que no le toca
 *    arreglar (pérdida de agua, tapa de cloaca, bocacalle). Es un pedido nuevo
 *    nacido en la calle; contarlo como trabajo hecho inventaría reparaciones.
 *
 * El estado sale de la foto de después, que es el mismo criterio que usa el
 * tablero de Leo: sin esa foto el bache está en curso, no terminado.
 */

const ORIGEN = "bacheo_empresas";

const puntoGasSchema = z.object({
  id: z.string().min(1),
  lat: z.union([z.number(), z.string()]).nullish(),
  lng: z.union([z.number(), z.string()]).nullish(),
  direccion: z.string().nullish(),
  tipoFalla: z.string().nullish(),
  tipoObra: z.string().nullish(),
  empresa: z.string().nullish(),
  superficie: z.union([z.number(), z.string()]).nullish(),
  volumen: z.union([z.number(), z.string()]).nullish(),
  tieneTicket: z.string().nullish(),
  numeroTicket: z.string().nullish(),
  fotoAntes: z.string().nullish(),
  fotoDespues: z.string().nullish(),
  fechaHora: z.string().nullish(),
});
export type PuntoGas = z.infer<typeof puntoGasSchema>;

/** Tipo de falla del formulario → tipo de problema de CIMBA. */
const TIPO_POR_FALLA: Record<string, TipoProblema> = {
  "bache": "bache",
  "bocacalle rota": "bache",
  "cuneta rota": "pavimento_deteriorado",
  "cuadra completa a realizar": "pavimento_deteriorado",
  "pérdida de agua": "perdida_agua",
  "perdida de agua": "perdida_agua",
  "cámara / tapa de cloaca rota": "tapa_registro",
  "camara / tapa de cloaca rota": "tapa_registro",
  "imbornales trancados": "sumidero",
};

/**
 * El campo de empresa es texto libre en el formulario y ya produjo cuatro
 * grafías de Ingeco (una con un cero en vez de la o). Se normaliza acá para que
 * el mismo contratista no aparezca como cuatro.
 */
export function normalizarEmpresa(bruto: string | null | undefined): string | null {
  const s = limpiarTexto(bruto);
  if (!s) return null;
  const k = s.toLowerCase().replace(/0/g, "o").replace(/\s+/g, " ").trim();
  if (k.startsWith("ingec")) return "Ingeco";
  if (k.includes("maza")) return "Elías Maza";
  if (k.startsWith("caller")) return "Calleri";
  if (k.includes("uocra")) return "UOCRA";
  if (k.includes("proycon")) return "Proycon";
  if (k.includes("contratuc")) return "Contratuc";
  if (k.includes("sercovial")) return "Sercovial";
  return s;
}

/** "-26,8275" o -26.8275 → número. El CSV trae coma decimal; el RPC, punto. */
function aNumero(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Google Sheets arruinó 306 de las 1.038 superficies: en configuración regional
 * argentina interpretó el decimal como fecha, y "2,2" quedó guardado como
 * 2026-02-02, "4,8" como 2026-08-04. El patrón es estable —el día es la parte
 * entera y el mes la decimal— así que el valor se recupera exacto.
 *
 * Solo ocurre cuando el número era ambiguo con una fecha (parte entera hasta 31
 * y decimal hasta 12); una superficie de 45,5 m² Sheets la dejó como número.
 * Devuelve null si no tiene la forma esperada, para no inventar un valor que
 * termina sumando en la brecha.
 */
function superficieDesdeFechaRota(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(v);
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (!Number.isFinite(mes) || !Number.isFinite(dia)) return null;
  const recuperado = Number(`${dia}.${mes}`);
  return Number.isFinite(recuperado) && recuperado > 0 ? recuperado : null;
}

/**
 * Un bache promedia 2,75 m² en esta planilla. Seis registros declaran entre 414
 * y 2.723 m² y entre ellos suman el 73 % de toda la superficie: son errores de
 * tipeo en el formulario (probablemente metros lineales o el volumen en el campo
 * equivocado). Dejarlos pasar multiplicaría por casi cuatro el trabajo ejecutado
 * que informa la brecha.
 *
 * No se descartan ni se corrigen a ojo: el valor declarado queda en metadata
 * para poder auditarlo, la superficie va en null —lo mismo que un bache sin
 * medir— y el CLI los lista para que alguien los revise en la planilla.
 */
const SUPERFICIE_MAX_CREIBLE = 200;

/** El id trae el epoch de creación: BACHE-1781702990334-6563. Respaldo de fecha. */
function fechaDesdeId(id: string): Date | null {
  const m = /^BACHE-(\d{13})-/.exec(id);
  if (!m) return null;
  const d = new Date(Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "17/06/2026 10:29:50" o ISO. Día y hora pueden venir sin cero adelante. */
function parsearFechaGas(v: string | null | undefined, id: string): Date | null {
  const s = limpiarTexto(v);
  if (s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) {
      const [, d = "1", mes = "1", a = "2026", h = "12", mi = "0", se = "0"] = m;
      const iso =
        `${a}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}` +
        `T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:${se.padStart(2, "0")}-03:00`;
      const f = new Date(iso);
      if (!Number.isNaN(f.getTime())) return f;
    }
    const iso = new Date(s);
    if (!Number.isNaN(iso.getTime())) return iso;
  }
  // Las 2 filas sin fecha se recuperan del epoch del id.
  return fechaDesdeId(id);
}

/** Extrae el id de archivo de una URL de Google Drive. Descarta basura tipo ",". */
export function idDriveDesdeUrl(v: string | null | undefined): string | null {
  const s = limpiarTexto(v);
  if (!s || s.length < 20) return null;
  const m = /\/file\/d\/([A-Za-z0-9_-]{20,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{20,})/.exec(s);
  return m?.[1] ?? null;
}

/**
 * URL directa a la imagen. Las fotos son públicas (verificado: responden
 * image/jpeg sin sesión), y este host además sirve miniaturas agregando
 * `=w<ancho>`, que evita bajar 3 MB para mostrar un recuadro en el mapa.
 */
export function urlFotoDrive(idArchivo: string, ancho?: number): string {
  return `https://lh3.googleusercontent.com/d/${idArchivo}${ancho ? `=w${ancho}` : ""}`;
}

export interface FotoEmpresa {
  idRemotoIntervencion: string;
  momento: "antes" | "despues";
  urlExterna: string;
  lat: number | null;
  lon: number | null;
  tomadaEn: Date | null;
}

export interface LoteEmpresas {
  demandas: DemandaNormalizada[];
  intervenciones: IntervencionNormalizada[];
  fotos: FotoEmpresa[];
  descartados: Array<{ id: string; motivo: string }>;
  /** Superficies declaradas que no son creíbles: no se computan, se listan. */
  sospechosos: Array<{ id: string; m2: number; direccion: string }>;
}

/** Convierte la planilla cruda en entidades de CIMBA. */
export function mapearLoteEmpresas(filas: unknown[]): LoteEmpresas {
  const lote: LoteEmpresas = {
    demandas: [],
    intervenciones: [],
    fotos: [],
    descartados: [],
    sospechosos: [],
  };

  for (const cruda of filas) {
    const p = puntoGasSchema.safeParse(cruda);
    if (!p.success) {
      lote.descartados.push({
        id: String((cruda as { id?: unknown })?.id ?? "?"),
        motivo: "no parsea",
      });
      continue;
    }
    const f = p.data;
    const lat = aNumero(f.lat);
    const lon = aNumero(f.lng);
    if (lat == null || lon == null) {
      lote.descartados.push({ id: f.id, motivo: "sin coordenadas" });
      continue;
    }

    const empresa = normalizarEmpresa(f.empresa);
    const falla = limpiarTexto(f.tipoFalla);
    const tipo: TipoProblema = TIPO_POR_FALLA[(falla ?? "").toLowerCase()] ?? "otro";
    const direccion = limpiarTexto(f.direccion);
    const fecha = parsearFechaGas(f.fechaHora, f.id);
    /**
     * Lo que decide si la fila es trabajo o detección es el TIPO DE OBRA, no la
     * superficie: 306 superficies están corrompidas y tratarlas como ausentes
     * convertiría 306 baches reparados en pedidos sin atender.
     */
    const supBruta = limpiarTexto(f.superficie == null ? null : String(f.superficie));
    let superficie = aNumero(f.superficie);
    let supRecuperada = false;
    if (superficie == null && supBruta) {
      superficie = superficieDesdeFechaRota(supBruta);
      supRecuperada = superficie != null;
    }
    // Superficie no creíble: se guarda el declarado y no se computa (ver arriba).
    let supSospechosa: number | null = null;
    if (superficie != null && superficie > SUPERFICIE_MAX_CREIBLE) {
      supSospechosa = superficie;
      superficie = null;
      lote.sospechosos.push({ id: f.id, m2: supSospechosa, direccion: direccion ?? "sin dirección" });
    }

    const tipoObra = limpiarTexto(f.tipoObra);
    const esTrabajo = Boolean(tipoObra) || superficie != null || supSospechosa != null;
    const idAntes = idDriveDesdeUrl(f.fotoAntes);
    const idDespues = idDriveDesdeUrl(f.fotoDespues);

    const metadataComun = {
      origen: ORIGEN,
      empresa,
      tipo_falla: falla,
      tipo_obra: tipoObra,
      ticket: limpiarTexto(f.numeroTicket),
      volumen_m3_declarado: aNumero(f.volumen),
      foto_antes: idAntes ? urlFotoDrive(idAntes) : null,
      foto_despues: idDespues ? urlFotoDrive(idDespues) : null,
      // Queda registrado para poder auditar el número que entra a la brecha.
      superficie_recuperada_de_fecha: supRecuperada || undefined,
      superficie_original: supRecuperada ? supBruta : undefined,
      superficie_declarada_no_creible: supSospechosa ?? undefined,
    };

    if (!esTrabajo) {
      /**
       * Sin superficie no hubo obra: la cuadrilla detectó algo que no repara.
       * Entra como pedido para que aparezca en la deuda, no como trabajo hecho.
       */
      lote.demandas.push(
        demandaNormalizadaSchema.parse({
          sistema: ORIGEN,
          idRemoto: f.id,
          fuente: "cuadrilla",
          tipo,
          descripcion: falla ? `Detectado en calle por ${empresa ?? "cuadrilla"}: ${falla}` : null,
          direccionTexto: direccion,
          direccionNormalizada: direccion ? normalizarDireccion(direccion) : null,
          punto: { lat, lon },
          // GPS de celular tomado en el lugar: la mejor coordenada del sistema.
          geocodConfianza: 0.95,
          distritoId: null,
          solicitante: empresa,
          prioridadInformada: null,
          menciones: null,
          urlOrigen: null,
          contacto: {},
          creadoEn: fecha,
          metadata: metadataComun,
        }),
      );
    } else {
      // La foto de después es el criterio de "terminado" del tablero de Leo.
      const terminada = Boolean(idDespues);
      lote.intervenciones.push(
        intervencionNormalizadaSchema.parse({
          sistema: ORIGEN,
          idRemoto: f.id,
          tipo,
          estado: terminada ? "finalizada" : "en_curso",
          punto: { lat, lon },
          geocodConfianza: 0.95,
          direccionTexto: direccion,
          superficieM2: superficie,
          iniciadaEn: fecha,
          finalizadaEn: terminada ? fecha : null,
          materiales: {},
          observaciones: tipoObra,
          metadata: metadataComun,
        }),
      );
    }

    if (idAntes) {
      lote.fotos.push({
        idRemotoIntervencion: f.id,
        momento: "antes",
        urlExterna: urlFotoDrive(idAntes),
        lat,
        lon,
        tomadaEn: fecha,
      });
    }
    if (idDespues) {
      lote.fotos.push({
        idRemotoIntervencion: f.id,
        momento: "despues",
        urlExterna: urlFotoDrive(idDespues),
        lat,
        lon,
        tomadaEn: fecha,
      });
    }
  }

  return lote;
}

/**
 * Trae la planilla entera por el RPC interno del Apps Script.
 *
 * El header x-same-domain es obligatorio (sin él responde 400) y la respuesta
 * viene con un prefijo anti-hijacking de cuatro caracteres antes del JSON, que
 * a su vez trae el payload doblemente serializado. No hay paginación: devuelve
 * todo, hoy 694 KB.
 */
export async function traerPuntosGas(deploymentId: string): Promise<unknown[]> {
  const base = `https://script.google.com/macros/s/${deploymentId}`;
  const res = await fetch(`${base}/callback?nocache_id=${Date.now()}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      origin: "https://script.google.com",
      referer: `${base}/exec`,
      "x-same-domain": "1",
    },
    body: new URLSearchParams({ request: '["getPuntos","[]",null,[0],null,null,1,0]' }),
  });
  if (!res.ok) throw new Error(`Apps Script respondió ${res.status}`);
  const texto = await res.text();
  const inicio = texto.indexOf("[");
  if (inicio < 0) throw new Error("respuesta del RPC sin JSON");
  const sobre = JSON.parse(texto.slice(inicio)) as unknown;
  // Estructura: [["op.exec",[0,"<json string>"]], ...]
  const capa = (sobre as unknown[])?.[0] as unknown[] | undefined;
  const interno = (capa?.[1] as unknown[] | undefined)?.[1];
  if (typeof interno !== "string") throw new Error("respuesta del RPC con forma inesperada");
  // Doble serialización: el valor es un string que contiene otro string JSON,
  // que recién adentro trae el array. Verificado contra la respuesta real.
  let datos: unknown = JSON.parse(interno);
  if (typeof datos === "string") datos = JSON.parse(datos);
  if (!Array.isArray(datos)) throw new Error("el RPC no devolvió una lista de puntos");
  return datos;
}

export const SISTEMA_EMPRESAS = ORIGEN;
