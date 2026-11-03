import React from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App.jsx";
import { migrateBrowserStorage } from "./studio/storage-migration.mjs";
import "@xyflow/react/dist/style.css";
import "./style.css";
import "./canvas/tool-rail.css";
try { migrateBrowserStorage(localStorage); } catch {}
createRoot(document.getElementById("root")).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);
