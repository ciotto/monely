import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Django dev server: localhost outside docker, the `backend` service inside it
  const backendUrl = env.BACKEND_URL || "http://localhost:8000";

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/api": backendUrl,
        "/admin": backendUrl,
        "/static": backendUrl,
      },
    },
    test: {
      environment: "jsdom",
      include: ["tests/**/*.test.js"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{js,vue}"],
        reporter: ["text", "html"],
        thresholds: {
          100: true,
        },
      },
    },
  };
});
