import React from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App.jsx";
import "@xyflow/react/dist/style.css";
import "./style.css";
import "./canvas/tool-rail.css";
createRoot(document.getElementById("root")).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);
