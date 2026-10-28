// Bundles test/shell-session.ts with shell-session's app-bound imports
// (workspace, overlay) swapped for test/shell-session-stubs.ts.
import { build } from 'esbuild'
import path from 'node:path'

const stub = path.resolve('test/shell-session-stubs.ts')

await build({
  entryPoints: ['test/shell-session.ts'],
  outfile: 'test/.out/shell-session.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  logLevel: 'warning',
  plugins: [
    {
      name: 'shell-session-stubs',
      setup(b) {
        b.onResolve({ filter: /^\.\/(workspace|overlay)$/ }, (args) =>
          args.importer.endsWith(path.join('services', 'shell-session.ts')) ? { path: stub } : null
        )
      }
    }
  ]
})
