import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

// The live Frappe site the dev server proxies to for real data + auth.
// Override with VITE_PROXY_TARGET when tunnelling (e.g. http://localhost:8000).
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || "https://erp.jewonline.in";

// Paths Frappe owns that must be forwarded to the backend during `vite dev`.
const proxied = ["/api", "/assets", "/files", "/private", "/app", "/method"];
const proxy = Object.fromEntries(
  proxied.map((p) => [
    p,
    {
      target: PROXY_TARGET,
      changeOrigin: true,
      secure: false,
      cookieDomainRewrite: "",
    },
  ]),
);

// After a production build, expose the SPA at the Frappe route /sitebill by
// copying the built index.html into the app's www/ folder. Runs only at build
// time inside whatever clone is building — never touches the installed app.
function emitWwwEntry() {
  return {
    name: "emit-www-entry",
    closeBundle() {
      const built = resolve(__dirname, "../dux_civil_works/public/frontend/index.html");
      const wwwDir = resolve(__dirname, "../dux_civil_works/www");
      if (existsSync(built)) {
        if (!existsSync(wwwDir)) mkdirSync(wwwDir, { recursive: true });
        copyFileSync(built, resolve(wwwDir, "sitebill.html"));
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  // dev: served from root; build: served as a Frappe app asset
  base: command === "build" ? "/assets/dux_civil_works/frontend/" : "/",
  plugins: [react(), emitWwwEntry()],
  server: {
    port: 8080,
    host: "0.0.0.0",
    proxy,
  },
  build: {
    outDir: "../dux_civil_works/public/frontend",
    emptyOutDir: true,
    sourcemap: false,
  },
}));
