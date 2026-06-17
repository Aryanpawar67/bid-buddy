import { createContext, useContext, useState } from "react";

type AiConfigureCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
};

const AiConfigureContext = createContext<AiConfigureCtx>({
  open: false,
  setOpen: () => {},
});

export function AiConfigureProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AiConfigureContext.Provider value={{ open, setOpen }}>
      {children}
    </AiConfigureContext.Provider>
  );
}

export function useAiConfigure() {
  return useContext(AiConfigureContext);
}
