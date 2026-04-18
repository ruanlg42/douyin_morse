import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const API_TARGET = process.env.VITE_PROXY_API ?? 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [react()],
  // 与后端 /assets（示例 mission.mp3 等）错开，避免生产环境同路径冲突
  build: {
    assetsDir: 'bundle',
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
      '/assets': { target: API_TARGET, changeOrigin: true },
    },
  },
})
