import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const API_TARGET = process.env.VITE_PROXY_API ?? 'http://127.0.0.1:8765'

// 离线模式：为抖音互动空间产出零网络依赖的静态包。
// 打开后，源码里所有 `if (!__OFFLINE__) { …fetch… }` 分支会被 esbuild 死代码消除，
// 从而通过 h5-validator 的「网络请求检测」硬门禁。
const OFFLINE = process.env.OFFLINE === '1' || process.env.OFFLINE === 'true'

// 离线包禁止任何外链资源（含远程字体）。开发/在线构建保留 Google Fonts，
// 离线构建时剥离 index.css 顶部的 @import，回退到 CSS 里已有的系统/中文字体栈。
const stripRemoteFontsPlugin = {
  name: 'strip-remote-fonts-offline',
  enforce: 'pre',
  transform(code, id) {
    if (!OFFLINE) return null
    if (!id.endsWith('.css')) return null
    if (!code.includes('fonts.googleapis.com')) return null
    const stripped = code.replace(/@import\s+url\(['"]https?:\/\/fonts\.googleapis\.com[^)]*\);?/g, '')
    return { code: stripped, map: null }
  },
}

export default defineConfig({
  plugins: [react(), stripRemoteFontsPlugin],
  // 离线包用相对路径，避免根路径无法定位 bundle/资源
  base: OFFLINE ? './' : '/',
  define: {
    __OFFLINE__: JSON.stringify(OFFLINE),
  },
  // 与后端 /assets（示例 mission.mp3 等）错开，避免生产环境同路径冲突
  build: {
    assetsDir: 'bundle',
    // 离线包为单 chunk 无动态 import，关闭 modulepreload polyfill，
    // 否则 Vite 会注入 fetch(link.href) 触发 h5-validator 的网络请求硬门禁
    modulePreload: OFFLINE ? false : { polyfill: true },
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
