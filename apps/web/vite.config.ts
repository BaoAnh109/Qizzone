import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      {
        find: /^@qizzone\/domain\/(.+)$/,
        replacement: `${fileURLToPath(new URL("../../packages/domain/src", import.meta.url))}/$1.ts`,
      },
      {
        find: /^@qizzone\/domain$/,
        replacement: fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
      },
      {
        find: /^@qizzone\/document-parser$/,
        replacement: fileURLToPath(new URL("../../packages/document-parser/src/index.ts", import.meta.url)),
      },
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pdfjs-dist")) {
            return "pdf-parser";
          }
          if (
            id.includes("node_modules/mammoth") ||
            id.includes("node_modules/jszip") ||
            id.includes("node_modules/@xmldom")
          ) {
            return "document-parser";
          }
          if (
            id.includes("node_modules/katex") ||
            id.includes("node_modules/dompurify")
          ) {
            return "katex";
          }
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react-router-dom") ||
            id.includes("node_modules/zustand")
          ) {
            return "vendor";
          }
        },
      },
    },
  },
});
