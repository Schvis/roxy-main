/**
 * Computer Vision & Camera Manager for Roxy VTuber mode.
 * Captures webcam frames to pass into Gemini / multimodal models.
 */
import type { ComposerImage } from './images'

export interface CameraDeviceInfo {
  deviceId: string
  label: string
}

export class CameraManager {
  private stream: MediaStream | null = null
  private videoEl: HTMLVideoElement | null = null
  private offscreenCanvas: HTMLCanvasElement | null = null

  async listDevices(): Promise<CameraDeviceInfo[]> {
    if (!navigator?.mediaDevices?.enumerateDevices) return []
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((d) => d.kind === 'videoinput')
      return videoDevices.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`
      }))
    } catch (err) {
      console.warn('[Vision] Failed to enumerate camera devices:', err)
      return []
    }
  }

  async start(deviceId?: string): Promise<MediaStream | null> {
    this.stop()

    const constraints: MediaStreamConstraints = {
      video:
        deviceId && deviceId !== 'default'
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints)
      if (!this.videoEl) {
        this.videoEl = document.createElement('video')
        this.videoEl.autoplay = true
        this.videoEl.muted = true
        this.videoEl.playsInline = true
      }
      this.videoEl.srcObject = this.stream
      await this.videoEl.play().catch(() => {})
      return this.stream
    } catch (err) {
      console.warn('[Vision] Failed to start camera stream:', err)
      return null
    }
  }

  getStream(): MediaStream | null {
    return this.stream
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoEl
  }

  captureFrame(): ComposerImage | null {
    if (!this.videoEl || this.videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null
    }

    const width = this.videoEl.videoWidth || 640
    const height = this.videoEl.videoHeight || 480

    // Bound max dimension for vision model efficiency (cap at 1024)
    const maxDim = 1024
    let targetWidth = width
    let targetHeight = height
    if (Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height)
      targetWidth = Math.round(width * scale)
      targetHeight = Math.round(height * scale)
    }

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas')
    }
    this.offscreenCanvas.width = targetWidth
    this.offscreenCanvas.height = targetHeight

    const ctx = this.offscreenCanvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(this.videoEl, 0, 0, targetWidth, targetHeight)
    const dataUrl = this.offscreenCanvas.toDataURL('image/jpeg', 0.85)

    return {
      id: crypto.randomUUID(),
      dataUrl,
      mediaType: 'image/jpeg',
      name: `webcam-${Date.now()}.jpg`
    }
  }

  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
      this.stream = null
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null
    }
  }
}

export const cameraManager = new CameraManager()
