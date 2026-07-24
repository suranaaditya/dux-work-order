import React from "react";
import ReactDOM from "react-dom/client";
import { FrappeProvider } from "frappe-react-sdk";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/global.css";

// In production the SPA is served by Frappe at /sitebill; in dev it's at /.
const basename = import.meta.env.PROD ? "/sitebill" : "/";
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
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </FrappeProvider>
  </React.StrictMode>,
);
