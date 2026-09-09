import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { OsShellParticipant } from "./os-shell/OsShellParticipant";
import { AssetProvider } from "./state/asset-store";
import { IdentityProvider } from "./state/identity-store";
import { OsProvider } from "./state/os-store";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <OsShellParticipant name="mybrandOS">
      <IdentityProvider>
        <AssetProvider>
          <OsProvider>
            <App />
          </OsProvider>
        </AssetProvider>
      </IdentityProvider>
      </OsShellParticipant>
    </BrowserRouter>
  </StrictMode>,
);
