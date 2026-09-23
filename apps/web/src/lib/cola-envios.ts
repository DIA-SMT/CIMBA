"use client";

import { useCallback, useEffect, useState } from "react";
import { esFalloDeRed } from "./errores";
import { avisarSesionVencida, sesionVigente } from "./sesion-cliente";

/**
 * LA COLA DE ENVÍOS: cargar sin señal y que se mande solo después.
 *
 * El capataz carga parado en la vereda, con datos móviles. Bajo un puente, en
 * un barrio con mala cobertura o con la antena saturada, el envío falla — y
 * hasta acá fallar era perder el reporte: el borrador guardaba lo tipeado pero
 * no las fotos, y las fotos son lo que más cuesta volver a producir (el bache
 * ya está tapado; la foto de antes no existe más).
 *
 * Ahora, si no hay red o el envío se corta, el reporte ENTERO —campos y fotos—
 * se guarda en el teléfono (IndexedDB, que sí aguanta blobs) y queda en una
 * cola visible: "2 trabajos guardados en el teléfono, se mandan cuando haya
 * señal". Se mandan solos al volver la conexión, al abrir el portal, o con un
 * botón. Cada uno es exactamente el mismo FormData que hubiera viajado en el
 * momento, a la misma acción del servidor: el servidor no sabe ni necesita
 * saber que llegó tarde.
 *
 * LO QUE NO ES: no es un caché de páginas ni un modo offline completo. El
 * portal necesita red para MOSTRAR la orden; lo que no necesita red es para
 * GUARDAR lo que la cuadrilla hizo. Esa es la mitad que importa en la calle.
 *
 * Dos honestidades incorporadas:
 *  - La fecha del trabajo se fija al ENCOLAR, no al enviar. Un bache tapado el
 *    lunes que sincroniza el jueves queda con fecha lunes.
 *  - Si el servidor RECHAZA el envío (no es un corte de red: es "este item ya
 *    fue reportado", "la orden no está activa"), el reporte no se reintenta
 *    para siempre: queda marcado con el motivo para que alguien decida.
 */

export type TipoEnvio = "reportarItemHecho" | "proponerItem" | "reportarTrabajoLibre";

export interface EnvioEncolado {
  id: number;
  tipo: TipoEnvio;
  /** Los campos de texto del FormData. */
  campos: Record<string, string>;
  /** Los archivos, por nombre de campo. */
  archivos: Record<string, { blob: Blob; nombre: string; tipo: string }>;
  /** Para poder mostrar qué es sin abrir el FormData: dónde y de qué orden. */
  contexto: { ordenId?: number; itemId?: number; direccion?: string | null };
  creadoEn: number;
  intentos: number;
  /** El servidor lo rechazó con esto: no se reintenta solo. */
  rechazo?: string;
}

const BD = "cimba-cola";
const STORE = "envios";
const EVENTO_CAMBIO = "cimba:cola-cambio";

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    if (typeof indexedDB === "undefined") {
      rechazar(new Error("sin IndexedDB"));
      return;
    }
    const req = indexedDB.open(BD, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error ?? new Error("no se pudo abrir la cola"));
  });
}

function pedir<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error ?? new Error("error de IndexedDB"));
  });
}

const avisarCambio = () => {
  try {
    window.dispatchEvent(new Event(EVENTO_CAMBIO));
  } catch {
    /* sin window: nada que avisar */
  }
};

/** El FormData desarmado en piezas que IndexedDB puede guardar. */
function desarmar(fd: FormData): Pick<EnvioEncolado, "campos" | "archivos"> {
  const campos: Record<string, string> = {};
  const archivos: EnvioEncolado["archivos"] = {};
  fd.forEach((valor, clave) => {
    if (valor instanceof File) {
      archivos[clave] = { blob: valor, nombre: valor.name || `${clave}.jpg`, tipo: valor.type || "image/jpeg" };
    } else {
      campos[clave] = String(valor);
    }
  });
  return { campos, archivos };
}

/** El FormData de vuelta, idéntico al que hubiera viajado en el momento. */
export function rearmar(envio: EnvioEncolado): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(envio.campos)) fd.set(k, v);
  for (const [k, a] of Object.entries(envio.archivos)) {
    fd.set(k, new File([a.blob], a.nombre, { type: a.tipo }));
  }
  return fd;
}

export async function listarCola(): Promise<EnvioEncolado[]> {
  try {
    const db = await abrir();
    const filas = await pedir(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
    db.close();
    return (filas as EnvioEncolado[]).sort((a, b) => a.creadoEn - b.creadoEn);
  } catch {
    return [];
  }
}

export async function quitarDeCola(id: number): Promise<void> {
  try {
    const db = await abrir();
    await pedir(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
    db.close();
  } finally {
    avisarCambio();
  }
}

async function guardar(envio: Omit<EnvioEncolado, "id">): Promise<void> {
  const db = await abrir();
  await pedir(db.transaction(STORE, "readwrite").objectStore(STORE).add(envio));
  db.close();
  avisarCambio();
}

async function actualizar(envio: EnvioEncolado): Promise<void> {
  const db = await abrir();
  await pedir(db.transaction(STORE, "readwrite").objectStore(STORE).put(envio));
  db.close();
  avisarCambio();
}

/** Hoy, como día de Tucumán, para fechar el trabajo al encolar. */
function hoyLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Tucuman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export type Ejecutor = (fd: FormData) => Promise<unknown>;

/**
 * ENVIAR, Y SI NO SE PUEDE, GUARDAR. La única puerta por la que los tres
 * formularios del portal mandan trabajo.
 *
 *  - Sin red (navigator.onLine false): se encola directo, sin intentar. Un
 *    intento fallido con fotos de 200 KB a 0 kbps tarda minutos en fallar.
 *  - Con red: se intenta. Si el fallo es de RED, se encola. Si el servidor
 *    contestó un error (medida inválida, item ya reportado), se relanza: eso
 *    lo tiene que arreglar la persona ahora, no la cola después.
 *
 * Devuelve si quedó encolado, para que el formulario lo diga con esas
 * palabras y no con un "enviado" que no es cierto.
 */
export async function enviarOEncolar(
  tipo: TipoEnvio,
  fd: FormData,
  contexto: EnvioEncolado["contexto"],
  ejecutor: Ejecutor,
): Promise<{ encolado: boolean }> {
  const encolar = async () => {
    // La fecha del trabajo es la de HOY, no la del día en que consiga señal.
    if (tipo !== "proponerItem" && !fd.get("fechaEjecucion")) fd.set("fechaEjecucion", hoyLocal());
    await guardar({ tipo, ...desarmar(fd), contexto, creadoEn: Date.now(), intentos: 0 });
    return { encolado: true };
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) return encolar();
  try {
    await ejecutor(fd);
    return { encolado: false };
  } catch (e) {
    if (esFalloDeRed(e)) return encolar();
    /* SESIÓN CERRADA: no es culpa de lo cargado. Se guarda en el teléfono
       igual que sin señal, y el cartel pide volver a entrar; al volver, la
       cola lo manda sola. Antes se perdía con un error genérico. */
    if (!(await sesionVigente())) {
      avisarSesionVencida();
      return encolar();
    }
    throw e;
  }
}

/**
 * Mandar lo que haya, en orden. Se detiene en el primer corte de red (sigue
 * sin señal: no tiene sentido seguir intentando); un rechazo del servidor deja
 * la marca en ese envío y sigue con el siguiente.
 */
export async function procesarCola(ejecutores: Record<TipoEnvio, Ejecutor>): Promise<{
  enviados: number;
  rechazados: number;
  sinRed: boolean;
}> {
  const r = { enviados: 0, rechazados: 0, sinRed: false };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ...r, sinRed: true };
  for (const envio of await listarCola()) {
    if (envio.rechazo) continue;
    try {
      await ejecutores[envio.tipo](rearmar(envio));
      await quitarDeCola(envio.id);
      r.enviados++;
    } catch (e) {
      if (esFalloDeRed(e)) {
        r.sinRed = true;
        break;
      }
      /* Sesión cerrada: se frena sin marcar nada como rechazado. Todo queda
         en la cola y sale después de volver a entrar. */
      if (!(await sesionVigente())) {
        avisarSesionVencida();
        break;
      }
      const mensaje = e instanceof Error ? e.message : "El servidor no lo aceptó";
      const digest = (e as { digest?: unknown } | null)?.digest;
      const visible =
        typeof digest === "string" && digest.startsWith("CIMBA_MSG:") ? digest.slice("CIMBA_MSG:".length) : mensaje;
      await actualizar({ ...envio, intentos: envio.intentos + 1, rechazo: visible });
      r.rechazados++;
    }
  }
  return r;
}

/** Cuántos hay y de qué clase, reactivo a cambios de la cola y de la red. */
export function useColaEnvios() {
  const [envios, setEnvios] = useState<EnvioEncolado[]>([]);
  const [enLinea, setEnLinea] = useState(true);

  const recargar = useCallback(() => {
    void listarCola().then(setEnvios);
  }, []);

  useEffect(() => {
    recargar();
    setEnLinea(navigator.onLine);
    const alCambiar = () => recargar();
    const alConectar = () => setEnLinea(true);
    const alDesconectar = () => setEnLinea(false);
    window.addEventListener(EVENTO_CAMBIO, alCambiar);
    window.addEventListener("online", alConectar);
    window.addEventListener("offline", alDesconectar);
    return () => {
      window.removeEventListener(EVENTO_CAMBIO, alCambiar);
      window.removeEventListener("online", alConectar);
      window.removeEventListener("offline", alDesconectar);
    };
  }, [recargar]);

  return {
    envios,
    pendientes: envios.filter((e) => !e.rechazo),
    rechazados: envios.filter((e) => Boolean(e.rechazo)),
    enLinea,
    recargar,
  };
}
