import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { RolUsuario } from "@cimba/domain";
import * as schema from "./schema";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof crearDb> | null = null;

function crearDb(client: ReturnType<typeof postgres>) {
  return drizzle(client, { schema });
}

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no configurada");
    _client = postgres(url, { prepare: false, max: 10 });
    _db = crearDb(_client);
  }
  return _db;
}

export type Db = ReturnType<typeof getDb>;

export interface ClaimsCimba {
  sub: string; // perfil.id
  rol_cimba: RolUsuario;
  id_persona: number;
}

/**
 * Ejecuta `fn` dentro de una transacción con los claims del usuario inyectados
 * en `request.jwt.claims`, de modo que las políticas RLS (cimba_rol(),
 * cimba_perfil()) apliquen igual que con PostgREST.
 */
export async function conRls<T>(
  claims: ClaimsCimba,
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
    );
    return fn(tx);
  });
}

export { schema };
export { sql } from "drizzle-orm";
export type { SQL } from "drizzle-orm";
