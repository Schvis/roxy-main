import type { Worker } from 'node:worker_threads'
import type { computeFileDiagnostics } from './file-diagnostics'
import type { WorkspaceFileDiagnostic } from '../../shared/api'

type Request = Parameters<typeof computeFileDiagnostics>
type Reply = { diagnostics: WorkspaceFileDiagnostic[] } | { error: string }

// One compiler isolate at a time. Idle termination releases its ASTs and heap.
export class DiagnosticsWorkerClient {
  private worker?: Worker
  private idleTimer?: ReturnType<typeof setTimeout>
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly createWorker: () => Worker,
    private readonly idleMs = 5_000
  ) {}

  compute = (...args: Request): Promise<WorkspaceFileDiagnostic[]> => {
    const result = this.queue.then(() => this.request(args))
    this.queue = result.catch(() => undefined)
    return result
  }

  private request(args: Request): Promise<WorkspaceFileDiagnostic[]> {
    clearTimeout(this.idleTimer)
    if (!this.worker) {
      const created = this.createWorker()
      const discard = (): void => {
        if (this.worker === created) this.worker = undefined
      }
      created.on('error', discard)
      created.on('exit', discard)
      this.worker = created
    }
    const worker = this.worker
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
      }
      const onError = (error: Error): void => {
        cleanup()
        if (this.worker === worker) this.worker = undefined
        void worker.terminate()
        reject(error)
      }
      const onExit = (code: number): void => {
        onError(new Error(`Diagnostics worker exited with code ${code}`))
      }
      const onMessage = (reply: Reply): void => {
        cleanup()
        this.idleTimer = setTimeout(() => {
          if (this.worker === worker) this.worker = undefined
          void worker.terminate()
        }, this.idleMs)
        this.idleTimer.unref()
        if ('error' in reply) reject(new Error(reply.error))
        else resolve(reply.diagnostics)
      }
      worker.once('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      try {
        worker.postMessage(args)
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}
