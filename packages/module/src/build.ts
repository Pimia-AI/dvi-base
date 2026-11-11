import { build } from 'esbuild'
/**
 * El bundle del módulo: un solo fichero de Node, sin `node_modules`, como `npm run build:modulo` de vet
 * (`esbuild … --bundle --platform=node --target=node24 --format=cjs --external:pg-native`). Dos variantes: `production`
 * (la imagen `module`) y `development` (el arranque local con el doble de Pimia).
 */
export async function buildBundle(entry: string, outfile: string, kind: 'production' | 'development' = 'production'): Promise<void> {
  await build({
    // En producción, `process.env.DVI_BUILD` es una constante y la rama del doble de Pimia desaparece del bundle.
    define: { 'process.env.DVI_BUILD': JSON.stringify(kind) },
    minifySyntax: true,
    entryPoints: [entry],
    outfile: outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['pg-native'],
    logLevel: 'error',
    legalComments: 'none',
  })
}
