import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { join } from 'node:path'
/** La cáscara del anfitrión de desarrollo, construida a `packages/dev-host/dist`. */
export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  plugins: [react(), tailwindcss()],
  build: { outDir: join(import.meta.dirname, '..', '..', 'dist'), emptyOutDir: true, assetsDir: 'assets' },
})
