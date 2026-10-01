import { parentPort } from 'node:worker_threads'
import { computeFileDiagnostics } from './file-diagnostics'

if (!parentPort) throw new Error('Diagnostics worker requires a parent port')

parentPort.on('message', (args: Parameters<typeof computeFileDiagnostics>) => {
  try {
    parentPort!.postMessage({ diagnostics: computeFileDiagnostics(...args) })
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
})
