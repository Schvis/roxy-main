import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { closeDb, getDb } from '../src/main/db/database'
import { getSettings, setToastNotificationsEnabled } from '../src/main/db/repo'

const root = mkdtempSync(join(tmpdir(), 'roxy-notification-settings-'))
app.setPath('userData', root)

void app.whenReady().then(() => {
  let exitCode = 0
  try {
    assert.equal(getSettings().toastNotificationsEnabled, true)
    assert.equal(setToastNotificationsEnabled(false).toastNotificationsEnabled, false)
    closeDb()
    assert.equal(getSettings().toastNotificationsEnabled, false)
    assert.equal(setToastNotificationsEnabled(true).toastNotificationsEnabled, true)
    closeDb()
    assert.equal(getSettings().toastNotificationsEnabled, true)
    getDb().prepare('DELETE FROM settings WHERE key = ?').run('toast_notifications_enabled')
    assert.equal(getSettings().toastNotificationsEnabled, true)
    console.log('Notification settings: default, toggle, persistence passed')
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    closeDb()
    rmSync(root, { recursive: true, force: true })
    app.exit(exitCode)
  }
})
