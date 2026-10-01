import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { DiagnosticsWorkerClient } from '../src/main/services/diagnostics-worker-client'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

class FakeWorker extends EventEmitter {
  sent: unknown[] = []
  terminated = false

  postMessage(args: unknown): void {
    this.sent.push(args)
  }

  async terminate(): Promise<number> {
    this.terminated = true
    this.emit('exit', 0)
    return 0
  }
}

async function main(): Promise<void> {
  const workers: FakeWorker[] = []
  const client = new DiagnosticsWorkerClient(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker as unknown as Worker
  }, 20)
  const args = ['root', 'target.ts', 'target.ts', 'const x = 1;'] as const
  assert.equal(workers.length, 0, 'worker must start lazily')
  const first = client.compute(...args)
  const second = client.compute(...args)
  await delay(0)
  assert.equal(workers.length, 1)
  assert.equal(workers[0].sent.length, 1, 'only one request in flight')
  workers[0].emit('message', { diagnostics: [] })
  await first
  await delay(0)
  assert.equal(workers[0].sent.length, 2, 'queued request reuses worker')
  await delay(30)
  assert.equal(workers[0].terminated, false, 'active request must not expire')
  workers[0].emit('message', { diagnostics: [] })
  await second
  await delay(30)
  assert.equal(workers[0].terminated, true, 'idle worker must release compiler heap')

  const failure = client.compute(...args)
  const rejected = assert.rejects(failure, /worker failure/)
  await delay(0)
  assert.equal(workers.length, 2, 'request after idle starts new worker')
  workers[1].emit('error', new Error('worker failure'))
  await rejected
  const retry = client.compute(...args)
  await delay(0)
  workers[2].emit('message', { error: 'diagnostic failure' })
  await assert.rejects(retry, /diagnostic failure/)
  await delay(30)

  const exit = client.compute(...args)
  const exitRejected = assert.rejects(exit, /exited with code 1/)
  await delay(0)
  workers[3].emit('exit', 1)
  await exitRejected

  const realWorkers: Worker[] = []
  const realClient = new DiagnosticsWorkerClient(() => {
    const worker = new Worker(path.join(__dirname, 'file-diagnostics-worker.cjs'))
    realWorkers.push(worker)
    return worker
  }, 20)
  const result = await realClient.compute(
    process.cwd(),
    path.join(process.cwd(), 'isolated-target.ts'),
    path.join(process.cwd(), 'isolated-target.ts'),
    'const wrong: number = "string";'
  )
  assert.ok(
    result.some((d) => d.code === 2322),
    'worker must return real type diagnostics'
  )
  const exited = new Promise<void>((resolve) => realWorkers[0].once('exit', () => resolve()))
  await exited
  console.log('Diagnostics worker tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
