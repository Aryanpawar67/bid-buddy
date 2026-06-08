import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const logger = createLogger();
const _warn = logger.warn.bind(logger);
logger.warn = (msg, opts) => {
  if (/Module "(?:node:)?(?:fs|path)" has been externalized/.test(msg)) return;
  _warn(msg, opts);
};

export default defineConfig({
  customLogger: logger,
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart({
      server: { entry: "server" },
    }),
    react(),
  ],
});
