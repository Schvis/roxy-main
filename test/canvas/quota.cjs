const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const userData = mkdtempSync(join(tmpdir(), 'roxy-quota-ui-'))
  try {
    const result = spawnSync(require('electron'), [__filename], {
      stdio: 'inherit',
      env: { ...process.env, ROXY_QUOTA_TEST_USER_DATA: userData }
    })
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', process.env.ROXY_QUOTA_TEST_USER_DATA)

  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1100, height: 850 })
    const js = (code) => win.webContents.executeJavaScript(code)
    const waitFor = async (code) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await js(code)) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error(`Timed out: ${code}`)
    }
    try {
      await win.loadURL('http://localhost:3114/providers.html?quota')
      await waitFor(
        `document.querySelector('[data-provider-account="codex-1"]')?.textContent.includes('73% left')`
      )
      assert.ok(
        await js(
          `document.querySelector('[data-provider-account="codex-2"]').textContent.includes('42% left')`
        ),
        'Quota stays scoped to account'
      )
      assert.ok(
        await js(
          `document.querySelector('[data-provider-account="codex-1"]').textContent.includes('91% left')`
        ),
        'Both windows visible without expanding account'
      )
      assert.ok(
        await js(
          `document.querySelector('[data-provider-account="codex-1"]').textContent.includes('Resets in')`
        ),
        'Reset time visible'
      )
      await waitFor(`document.querySelector('[data-chat-quota]')?.textContent.includes('73% left')`)
      await js(`document.querySelector('[data-chat-quota] button').click()`)
      await waitFor(`document.querySelector('[data-chat-quota]').textContent.includes('Weekly')`)
      await js(
        `document.querySelector('[data-provider-account="codex-1"] button[aria-label="Refresh"]').click()`
      )
      await waitFor(
        `window.quotaState().some(c => c.connectionId === 'codex-1' && c.force === true)`
      )
      await waitFor(
        `!document.querySelector('[data-provider-account="codex-1"] button[aria-label="Refresh"]').disabled`
      )
      await js(
        `window.failQuota(true); document.querySelector('[data-provider-account="codex-1"] button[aria-label="Refresh"]').click()`
      )
      await waitFor(
        `document.querySelector('[data-provider-account="codex-1"]').textContent.includes('Usage limits unavailable')`
      )
      assert.ok(
        await js(
          `document.querySelector('[data-provider-account="codex-1"]').textContent.includes('Test quota failure')`
        )
      )
      assert.equal(
        await js(
          `document.querySelector('[data-provider-account="codex-1"]').textContent.includes('73% left')`
        ),
        false,
        'Failure does not fabricate remaining quota'
      )
      await js(
        `window.failQuota(false); document.querySelector('[data-provider-account="codex-1"] button[aria-label="Refresh"]').click()`
      )
      await waitFor(
        `document.querySelector('[data-provider-account="codex-1"]').textContent.includes('73% left')`
      )
      await win.loadURL('http://localhost:3114/providers.html?quota&non-codex')
      await waitFor(`document.querySelectorAll('[data-provider-account]').length === 2`)
      assert.equal(await js(`window.quotaState().length`), 0, 'Other providers unchanged')
      console.log(
        'PASS: Codex settings quota, chat quota, account isolation, refresh, failure/recovery'
      )
      win.destroy()
      app.exit(0)
    } catch (error) {
      console.error(error)
      win.destroy()
      app.exit(1)
    }
  })
}
