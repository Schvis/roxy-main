import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface HeadpatAudioResult {
  audioBase64: string
  format: string
  name: string
  text?: string
}

export function getHeadpatAudioDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'resources', 'voicelines', 'headpat'),
    path.join(app.getAppPath(), 'resources', 'voicelines', 'headpat')
  ]

  if (app.isPackaged) {
    candidates.unshift(
      path.join(process.resourcesPath, 'voicelines', 'headpat'),
      path.join(process.resourcesPath, 'resources', 'voicelines', 'headpat')
    )
  }

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return null
}

export async function getRandomHeadpatAudio(): Promise<HeadpatAudioResult | null> {
  const dir = getHeadpatAudioDir()
  if (!dir) return null

  try {
    const entries = await fs.promises.readdir(dir)
    const audioFiles = entries.filter((f) => /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f))
    if (audioFiles.length === 0) return null

    const randomFile = audioFiles[Math.floor(Math.random() * audioFiles.length)]
    const fullPath = path.join(dir, randomFile)
    const buffer = await fs.promises.readFile(fullPath)
    const ext = path.extname(randomFile).toLowerCase().replace('.', '')
    const format =
      ext === 'mp3'
        ? 'audio/mp3'
        : ext === 'wav'
          ? 'audio/wav'
          : ext === 'ogg'
            ? 'audio/ogg'
            : `audio/${ext}`

    let text: string | undefined
    try {
      const messagesJsonPath = path.join(dir, 'messages.json')
      if (fs.existsSync(messagesJsonPath)) {
        const raw = await fs.promises.readFile(messagesJsonPath, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && parsed[randomFile]) {
          text = String(parsed[randomFile])
        }
      }
    } catch {
      // ignore
    }

    if (!text) {
      const txtPath = path.join(dir, `${path.parse(randomFile).name}.txt`)
      if (fs.existsSync(txtPath)) {
        try {
          text = (await fs.promises.readFile(txtPath, 'utf8')).trim()
        } catch {
          // ignore
        }
      }
    }

    return {
      audioBase64: buffer.toString('base64'),
      format,
      name: randomFile,
      text
    }
  } catch (err) {
    console.warn('[Headpat] Failed to read headpat audio:', err)
    return null
  }
}
