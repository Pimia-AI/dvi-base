import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { join } from 'node:path'
/** Las pantallas se construyen a `dist/ui` y las sirve el propio módulo en `/app/*` (`UI_DIR`). */
export default defineConfig({
  root: import.meta.dirname,
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: { outDir: join(import.meta.dirname, '..', '..', 'dist', 'ui'), emptyOutDir: true, assetsDir: 'assets' },
})
