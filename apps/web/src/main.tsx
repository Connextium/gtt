import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");

if (!root) {
  throw new Error("root_element_not_found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
