"use client";

/**
 * LAS FOTOS DEL BORRADOR: que el "antes" no se pierda si se cierra la app.
 *
 * El capataz saca la foto del ANTES al llegar, tapa el bache (media hora, una
 * hora) y recién ahí saca la del DESPUÉS y manda. En el medio pasa de todo: el
 * teléfono descarta la pestaña, entra una llamada, se cierra la app. El
 * borrador de memoria-carga.ts ya rescataba lo tipeado, pero no las fotos —
 * localStorage no guarda imágenes— y la del antes no se puede volver a sacar:
 * el bache ya está tapado. "Guardado provisorio del antes, si se cierra"
 * (pedido del usuario, 14/10).
 *
 * Se guardan en IndexedDB (que sí aguanta imágenes), en una base aparte de la
 * cola de envíos para no tocar su versión. Viven solo en el teléfono, no viajan
 * a ningún lado, y se borran cuando el reporte se manda o se encola. Si el
 * navegador no deja usar IndexedDB (modo privado), todo falla en silencio y el
 * formulario anda como antes.
 */

const BD = "cimba-borradores";
const STORE = "fotos";

interface FotoGuardada {
  blob: Blob;
  nombre: string;
  tipo: string;
  guardadaEn: number;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    if (typeof indexedDB === "undefined") {
      rechazar(new Error("sin IndexedDB"));
      return;
    }
    const req = indexedDB.open(BD, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error ?? new Error("no se pudo abrir el borrador"));
  });
}

async function conStore<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  try {
    return await new Promise<T>((resolver, rechazar) => {
      const req = fn(db.transaction(STORE, modo).objectStore(STORE));
      req.onsuccess = () => resolver(req.result);
      req.onerror = () => rechazar(req.error ?? new Error("error del borrador"));
    });
  } finally {
    db.close();
  }
}

/** La clave de una foto: de qué bache y cuál (antes / después). */
export const claveFoto = (itemId: number, cual: "antes" | "despues") => `item:${itemId}:${cual}`;

/** Guarda la foto (ya comprimida) o, con null, la saca del borrador. */
export async function guardarFotoBorrador(clave: string, archivo: File | null): Promise<void> {
  try {
    if (!archivo) {
      await conStore("readwrite", (s) => s.delete(clave));
      return;
    }
    const foto: FotoGuardada = { blob: archivo, nombre: archivo.name, tipo: archivo.type, guardadaEn: Date.now() };
    await conStore("readwrite", (s) => s.put(foto, clave));
  } catch {
    /* sin IndexedDB: se sigue sin borrador de fotos */
  }
}

/** La foto guardada, de vuelta como archivo listo para el formulario. */
export async function leerFotoBorrador(clave: string): Promise<File | null> {
  try {
    const f = (await conStore("readonly", (s) => s.get(clave))) as FotoGuardada | undefined;
    if (!f?.blob) return null;
    return new File([f.blob], f.nombre || "foto.jpg", { type: f.tipo || f.blob.type, lastModified: f.guardadaEn });
  } catch {
    return null;
  }
}

/** Lo mismo para el bache que la cuadrilla propone (todavía no tiene item): uno por orden. */
export const claveFotoPropuesta = (ordenId: number, cual: "antes" | "despues") => `propuesta:${ordenId}:${cual}`;

export async function borrarFotosPropuesta(ordenId: number): Promise<void> {
  await guardarFotoBorrador(claveFotoPropuesta(ordenId, "antes"), null);
  await guardarFotoBorrador(claveFotoPropuesta(ordenId, "despues"), null);
}

/** Saca del borrador las dos fotos de un bache: se mandó, se encoló o se empezó de cero. */
export async function borrarFotosBorrador(itemId: number): Promise<void> {
  await guardarFotoBorrador(claveFoto(itemId, "antes"), null);
  await guardarFotoBorrador(claveFoto(itemId, "despues"), null);
}
