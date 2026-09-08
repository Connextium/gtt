import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          const modulePath = id.split("node_modules/")[1];
          if (!modulePath) return "vendor";
          const moduleName = modulePath.startsWith("@")
            ? modulePath.split("/").slice(0, 2).join("/")
            : modulePath.split("/")[0];
          const normalizedName = moduleName.replace("@", "").replace(/[^a-zA-Z0-9_-]/g, "-");
          return `vendor-${normalizedName}`;
        }
      }
    }
  }
});
