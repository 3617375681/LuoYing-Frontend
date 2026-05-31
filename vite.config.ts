import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'
import { createDashscopeAsrProxy } from './src/features/meeting-agent/viteDashscopeAsrProxy'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: './',
    plugins: [
      inspectAttr(),
      react(),
      createDashscopeAsrProxy({
        apiKey: env.DASHSCOPE_API_KEY,
        url: env.DASHSCOPE_ASR_URL,
        model: env.DASHSCOPE_ASR_MODEL,
      }),
    ],
    server: {
      port: 3000,
      proxy: {
        '/luoying-api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/luoying-api/, ''),
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})
