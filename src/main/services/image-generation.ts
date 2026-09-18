import type { GeneratedImage, ImageGenerationInput, ImageGenerationResult } from '../../shared/api'
import { openaiImageEndpoint } from './llm'
import { ModelHttpError } from './model-http-error'

interface ImageResponseItem {
  b64_json?: unknown
  url?: unknown
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

function mimeFromFormat(format: string): string {
  return format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : `image/${format}`
}

async function durableUrl(url: string, signal: AbortSignal): Promise<GeneratedImage> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new ModelHttpError(response.status, 'Generated image download failed.')
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_IMAGE_BYTES) throw new Error('Generated image is too large.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Generated image is too large.')
  const mediaType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  return {
    dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
    mediaType
  }
}

export async function generateImages(
  input: ImageGenerationInput,
  signal: AbortSignal
): Promise<ImageGenerationResult> {
  const model = input.model.trim()
  const prompt = input.prompt.trim()
  if (!model) return { ok: false, error: 'Choose an image model first.' }
  if (!prompt) return { ok: false, error: 'Enter an image prompt first.' }

  const endpoint = await openaiImageEndpoint(input.providerId)
  const outputFormat = 'png'
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: endpoint.headers,
    signal,
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      image_detail: 'high',
      output_format: outputFormat
    })
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new ModelHttpError(
      response.status,
      `Image generation failed (${response.status})${detail ? `: ${detail}` : '.'}`
    )
  }

  const payload = (await response.json()) as { data?: ImageResponseItem[] }
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error('Image endpoint returned no images.')
  }
  const mediaType = mimeFromFormat(outputFormat)
  const images = await Promise.all(
    payload.data.map(async (item, index): Promise<GeneratedImage> => {
      if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
        return {
          dataUrl: `data:${mediaType};base64,${item.b64_json}`,
          mediaType,
          name: `generated-${index + 1}.${outputFormat}`
        }
      }
      if (typeof item.url === 'string' && item.url.length > 0) {
        return { ...(await durableUrl(item.url, signal)), name: `generated-${index + 1}` }
      }
      throw new Error('Image endpoint returned an invalid image.')
    })
  )
  return { ok: true, images }
}
