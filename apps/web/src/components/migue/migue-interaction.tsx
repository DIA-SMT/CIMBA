"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { MigueInteraction, MigueMode } from "./migue-scene";

type InteractionContext = MigueInteraction & {
  select: (mode: MigueMode) => void;
  wink: () => void;
};
const Context = createContext<InteractionContext | null>(null);

/** Only interaction states cross this boundary; credentials stay inside the form. */
export function MigueInteractionProvider({ children }: { children: ReactNode }) {
  const [mode, select] = useState<MigueMode>("idle");
  const [winkId, setWinkId] = useState(0);
  const wink = useCallback(() => setWinkId((value) => value + 1), []);
  const value = useMemo(() => ({ mode, winkId, select, wink }), [mode, winkId, wink]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMigueInteraction() {
  const value = useContext(Context);
  if (!value) throw new Error("Migue requiere su contexto de interacción");
  return value;
}
