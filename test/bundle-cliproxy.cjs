const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { promises: fs } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')

const scriptPath = path.join(__dirname, '..', 'script', 'bundle-cliproxy.cjs')
const version = '8.0.13'
const asset = `CLIProxyAPI_${version}_windows_amd64.zip`
const archive = Buffer.from('test archive')
const digest = createHash('sha256').update(archive).digest('hex')
const archiveUrl = 'https://github.com/test/archive'
const checksumUrl = 'https://github.com/test/checksums'

async function fixture(
  t,
  { publishedDigest = `sha256:${digest}`, checksums = true, replies = {} } = {}
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roxy-bundle-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const calls = []
  const waits = []
  const assets = [{ name: asset, digest: publishedDigest, browser_download_url: archiveUrl }]
  if (checksums) assets.push({ name: 'checksums.txt', browser_download_url: checksumUrl })
  const release = { tag_name: `v${version}`, assets }
  const module = { exports: {} }
  vm.runInNewContext(
    await fs.readFile(scriptPath, 'utf8'),
    {
      module,
      Buffer,
      AbortSignal,
      console: { log() {}, warn() {} },
      process: { platform: process.platform, env: { CLIPROXY_VERSION: version } },
      require(name) {
        if (name === 'node:timers/promises') {
          return { setTimeout: async (ms) => waits.push(ms) }
        }
        if (name === 'node:child_process') {
          return {
            execFile(_file, args, callback) {
              fs.writeFile(path.join(args[3], 'cli-proxy-api.exe'), 'test binary').then(
                () => callback(null, '', ''),
                callback
              )
            }
          }
        }
        return require(name)
      },
      async fetch(url) {
        calls.push(url)
        const queue = replies[url]
        const reply = queue?.length ? queue.shift() : undefined
        if (reply instanceof Error) throw reply
        const status = typeof reply === 'number' ? reply : 200
        const body =
          reply?.body ??
          (url === archiveUrl
            ? archive
            : url === checksumUrl
              ? Buffer.from(`${digest}  ${asset}\n`)
              : Buffer.from(JSON.stringify(release)))
        return {
          ok: status >= 200 && status < 300,
          status,
          async arrayBuffer() {
            if (reply?.bodyError) throw reply.bodyError
            return body
          }
        }
      }
    },
    { filename: scriptPath }
  )
  return {
    calls,
    waits,
    root,
    run: () =>
      module.exports({
        electronPlatformName: 'win32',
        arch: 1,
        appOutDir: root,
        packager: { getResourcesDir: () => root }
      }),
    manifest: async () =>
      JSON.parse(await fs.readFile(path.join(root, 'cliproxy', 'manifest.json')))
  }
}

test('published digest skips checksum download and bundles verified archive', async (t) => {
  const f = await fixture(t, { replies: { [checksumUrl]: [500] } })
  await f.run()
  assert.ok(!f.calls.includes(checksumUrl))
  assert.equal((await f.manifest()).archiveSha256, digest)
  assert.equal(
    await fs.readFile(path.join(f.root, 'cliproxy', 'cli-proxy-api.exe'), 'utf8'),
    'test binary'
  )
})

test('published digest works without checksums.txt asset', async (t) => {
  const f = await fixture(t, { checksums: false })
  await f.run()
  assert.equal((await f.manifest()).version, version)
})

for (const publishedDigest of [undefined, 'sha256:invalid']) {
  test(`checksum fallback verifies archive when digest is ${publishedDigest}`, async (t) => {
    const f = await fixture(t, { publishedDigest: publishedDigest ?? null })
    await f.run()
    assert.ok(f.calls.includes(checksumUrl))
    assert.equal((await f.manifest()).archiveSha256, digest)
  })
}

for (const failure of [
  500,
  502,
  408,
  429,
  new Error('connection reset'),
  { bodyError: new Error('body interrupted') }
]) {
  test(`transient download failure retries: ${failure.message ?? failure.bodyError?.message ?? failure}`, async (t) => {
    const f = await fixture(t, { replies: { [archiveUrl]: [failure] } })
    await f.run()
    assert.equal(f.calls.filter((url) => url === archiveUrl).length, 2)
    assert.deepEqual(f.waits, [1000])
  })
}

test('checksum download retries transient failure', async (t) => {
  const f = await fixture(t, { publishedDigest: null, replies: { [checksumUrl]: [500] } })
  await f.run()
  assert.equal(f.calls.filter((url) => url === checksumUrl).length, 2)
})

test('release metadata download retries transient failure', async (t) => {
  const metadataUrl = `https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/tags/v${version}`
  const f = await fixture(t, { replies: { [metadataUrl]: [503] } })
  await f.run()
  assert.equal(f.calls.filter((url) => url === metadataUrl).length, 2)
})

test('permanent HTTP failure does not retry', async (t) => {
  const f = await fixture(t, { replies: { [archiveUrl]: [404] } })
  await assert.rejects(f.run(), /Couldn't download .* \(404\)/)
  assert.deepEqual(f.waits, [])
})

test('persistent transient failure stops after four attempts', async (t) => {
  const f = await fixture(t, { replies: { [archiveUrl]: [500, 500, 500, 500] } })
  await assert.rejects(f.run(), /Couldn't download .* \(500\)/)
  assert.equal(f.calls.filter((url) => url === archiveUrl).length, 4)
  assert.deepEqual(f.waits, [1000, 2000, 4000])
})

test('missing digest and checksum asset fail before archive download', async (t) => {
  const f = await fixture(t, { publishedDigest: null, checksums: false })
  await assert.rejects(f.run(), /no published SHA-256/)
  assert.ok(!f.calls.includes(archiveUrl))
})

test('missing checksum entry fails before archive download', async (t) => {
  const f = await fixture(t, {
    publishedDigest: null,
    replies: { [checksumUrl]: [{ body: Buffer.from('no checksum') }] }
  })
  await assert.rejects(f.run(), /checksums.txt has no SHA-256/)
  assert.ok(!f.calls.includes(archiveUrl))
})

test('digest mismatch fails without installing binary', async (t) => {
  const f = await fixture(t, {
    replies: { [archiveUrl]: [{ body: Buffer.from('modified archive') }] }
  })
  await assert.rejects(f.run(), /integrity check failed/)
  await assert.rejects(fs.stat(path.join(f.root, 'cliproxy')), { code: 'ENOENT' })
})
