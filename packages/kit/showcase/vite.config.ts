import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
/** La página de muestra del kit: solo en local, en 127.0.0.1:7170. */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 7170, strictPort: true },
  preview: { host: '127.0.0.1', port: 7170, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
