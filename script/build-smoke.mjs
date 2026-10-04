import { build } from 'esbuild'
import path from 'node:path'

const [entry, outfile] = process.argv.slice(2)
if (!entry || !outfile) throw new Error('Usage: build-smoke.mjs <entry> <outfile>')

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  loader: { '.png': 'file' },
  plugins: [
    {
      name: 'node-worker',
      setup(builder) {
        builder.onResolve({ filter: /\?nodeWorker$/ }, async (args) => {
          const source = path.resolve(args.resolveDir, `${args.path.slice(0, -11)}.ts`)
          const workerFile = path.resolve(
            path.dirname(outfile),
            `${path.basename(source, '.ts')}.cjs`
          )
          await build({
            entryPoints: [source],
            outfile: workerFile,
            bundle: true,
            platform: 'node',
            format: 'cjs',
            packages: 'external'
          })
          return { path: workerFile, namespace: 'node-worker' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'node-worker' }, (args) => ({
          contents: `import { Worker } from 'node:worker_threads'; export default function () { return new Worker(${JSON.stringify(args.path)}); }`,
          loader: 'js'
        }))
      }
    }
  ]
})
