import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

// The live Frappe site the dev server proxies to for real data + auth.
// Override with VITE_PROXY_TARGET when tunnelling (e.g. http://localhost:8000).
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || "https://erp.jewonline.in";

// For the isolated dev preview against a live site, the proxy injects an API
// token ("key:secret") on every forwarded request — server-side only, so no
// secret ever reaches the browser. Set via the shell env when starting vite.
// In production (served same-origin by Frappe) this is unset and cookie auth
// is used instead.
const PROXY_AUTH = process.env.VITE_FRAPPE_TOKEN;
const TARGET_SITE = new URL(PROXY_TARGET).hostname;

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
      configure: (proxyServer: any) => {
        proxyServer.on("proxyReq", (proxyReq: any) => {
          // frappe-js-sdk auto-sends X-Frappe-Site-Name = window.location.hostname
          // ("localhost"), which selects the wrong site on a multi-tenant bench and
          // 404s. Force it to the real target site.
          proxyReq.setHeader("X-Frappe-Site-Name", TARGET_SITE);
          // Authenticate the isolated preview server-side (no secret in the client).
          if (PROXY_AUTH) proxyReq.setHeader("Authorization", `token ${PROXY_AUTH}`);
        });
      },
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
