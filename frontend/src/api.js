/**
 * 开发环境：Vite 将 /api、/media、/assets 代理到后端，API_BASE 置空即可。
 * 预览/生产若未配置代理：设 VITE_API_BASE=http://127.0.0.1:8765
 */
const raw = import.meta.env.VITE_API_BASE ?? '';
export const API_BASE = String(raw).replace(/\/$/, '');

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}
