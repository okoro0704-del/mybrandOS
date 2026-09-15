import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    host: "127.0.0.1",
    strictPort: false,
    allowedHosts: [".localhost"],
    proxy: {
      "/api": {
        target: "http://localhost:8793",
        changeOrigin: true,
      },
      "/.well-known/os-shell.json": { target: "http://localhost:8793", changeOrigin: false },
    },
  },
});
