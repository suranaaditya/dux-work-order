import React from "react";
import ReactDOM from "react-dom/client";
import { FrappeProvider } from "frappe-react-sdk";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/global.css";

// Hash routing so the SPA needs no server-side route rules: Frappe always
// serves the single www/sitebill.html at /sitebill, and the client owns
// everything after the # — deep-link refreshes work with no gunicorn reload.
// Same-origin in dev (vite proxy) and prod (served by Frappe) -> relative "".
const frappeUrl = import.meta.env.VITE_FRAPPE_URL ?? "";

// Optional API-token auth, used ONLY for the isolated server preview against the
// live site (set VITE_FRAPPE_TOKEN="key:secret"). Never committed; when unset the
// app uses same-origin cookie auth (the production path).
const tokenParams = import.meta.env.VITE_FRAPPE_TOKEN
  ? { useToken: true, type: "token" as const, token: () => import.meta.env.VITE_FRAPPE_TOKEN as string }
  : undefined;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FrappeProvider url={frappeUrl} tokenParams={tokenParams}>
      <HashRouter>
        <App />
      </HashRouter>
    </FrappeProvider>
  </React.StrictMode>,
);
