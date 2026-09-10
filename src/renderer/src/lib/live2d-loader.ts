/**
 * Dynamic loader and controller for Live2D Cubism runtime in Roxy.
 * Uses PixiJS 6 + pixi-live2d-display Cubism 4, mirroring Vixevia's setup.
 */

let loadPromise: Promise<boolean> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(script)
  })
}

async function loadScriptWithFallback(localSubpath: string, cdnUrl: string): Promise<void> {
  const localUrl =
    typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? './' + localSubpath.replace(/^\.?\//, '')
      : '/' + localSubpath.replace(/^\.?\//, '')

  try {
    await loadScript(localUrl)
  } catch {
    await loadScript(cdnUrl)
  }
}

/** Resolves any relative, absolute, or Windows path into a valid Electron/browser URL. */
export function resolveModelUrl(modelPath: string): string {
  if (!modelPath) return './models/live2d/roxy/Roxy_V1.model3.json'
  const trimmed = modelPath.trim()

  // Full URL
  if (/^(https?|file):\/\//i.test(trimmed)) {
    return trimmed
  }

  // Windows absolute path e.g. D:\path\to\model.model3.json
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return 'file:///' + trimmed.replace(/\\/g, '/')
  }

  // File protocol leading slash: /models/... resolves to drive root unless made relative ./models/...
  if (trimmed.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      return '.' + trimmed
    }
    return trimmed
  }

  // Relative path without ./ prefix
  if (!trimmed.startsWith('./')) {
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      return './' + trimmed
    }
  }

  return trimmed
}

/** Ensure Live2D Cubism Core, PixiJS, and pixi-live2d-display are loaded into window. */
export async function ensureLive2dLoaded(): Promise<boolean> {
  if (typeof window === 'undefined') return false

  const w = window as any
  if (w.PIXI?.live2d?.Live2DModel) {
    return true
  }

  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      // 1. Cubism core libraries
      await loadScriptWithFallback(
        'lib/live2d/live2dcubismcore.min.js',
        'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
      )
      // 2. Legacy Live2D 2.1 core (for broad model compatibility)
      try {
        await loadScriptWithFallback(
          'lib/live2d/live2d.min.js',
          'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js'
        )
      } catch {
        // Non-critical if only Cubism 3/4 models are used
      }
      // 3. PixiJS 6
      await loadScriptWithFallback(
        'lib/live2d/pixi.min.js',
        'https://cdn.jsdelivr.net/npm/pixi.js@6.5.2/dist/browser/pixi.min.js'
      )
      // 4. Pixi Live2D Display Cubism 4 bundle
      await loadScriptWithFallback(
        'lib/live2d/cubism4.min.js',
        'https://cdn.jsdelivr.net/gh/RaSan147/pixi-live2d-display@v0.4.0-ls-2/dist/cubism4.min.js'
      )

      return !!(window as any).PIXI?.live2d?.Live2DModel
    } catch (err) {
      console.warn('[Live2D] Failed to load Live2D scripts:', err)
      return false
    }
  })()

  return loadPromise
}

export class Live2dModelController {
  private app: any = null
  private model: any = null
  private modelPath: string = ''
  private blinkTimer: any = null
  private breathAngle = 0
  private breathTimer: any = null
  private zoom: number = 1.0
  private panX: number = 0
  private panY: number = 0
  private currentMouthOpenY = 0

  constructor(app: any, modelPath: string) {
    this.app = app
    this.modelPath = modelPath
  }

  getZoom(): number {
    return this.zoom
  }

  adjustZoom(factor: number, cx?: number, cy?: number): void {
    const oldZoom = this.zoom
    const newZoom = Math.max(0.3, Math.min(6.0, oldZoom * factor))
    if (Math.abs(newZoom - oldZoom) < 0.001) return

    const width = this.app?.renderer?.width || this.app?.view?.width || 320
    const height = this.app?.renderer?.height || this.app?.view?.height || 380
    const ratio = newZoom / oldZoom

    if (cx !== undefined && cy !== undefined) {
      const baseCenterX = width / 2
      const baseCenterY = height / 2 + 10
      this.panX = cx - baseCenterX - (cx - baseCenterX - this.panX) * ratio
      this.panY = cy - baseCenterY - (cy - baseCenterY - this.panY) * ratio
    } else {
      this.panX *= ratio
      this.panY *= ratio
    }

    this.zoom = newZoom
    this.resize()
  }

  pan(dx: number, dy: number): void {
    this.panX += dx
    this.panY += dy
    this.resize()
  }

  resetZoomAndPan(): void {
    this.zoom = 1.0
    this.panX = 0
    this.panY = 0
    this.resize()
  }

  async load(): Promise<boolean> {
    const w = window as any
    if (!w.PIXI?.live2d?.Live2DModel || !this.app) return false

    const targetUrl = resolveModelUrl(this.modelPath)

    try {
      if (this.model) {
        this.app.stage.removeChild(this.model)
        this.model.destroy()
        this.model = null
      }

      this.model = await w.PIXI.live2d.Live2DModel.from(targetUrl)
      this.app.stage.addChild(this.model)

      // Ensure EyeBlink does not hijack mouth parameters in case model3.json still had it
      try {
        const eyeBlink = this.model.internalModel?.eyeBlink
        if (eyeBlink && Array.isArray(eyeBlink._parameterIds)) {
          eyeBlink._parameterIds = eyeBlink._parameterIds.filter(
            (id: string) => id !== 'ParamMouthOpenY' && id !== 'ParamMouthForm'
          )
        }
      } catch {
        // ignore
      }

      // Enforce lip-sync and default mouth parameters on every frame update
      try {
        this.model.internalModel?.on?.('beforeModelUpdate', () => {
          try {
            const core = this.model?.internalModel?.coreModel
            if (core) {
              core.setParameterValueById?.('ParamMouthOpenY', this.currentMouthOpenY)
              core.setParameterValueById?.('ParamMouthForm', 1)
            }
          } catch {
            // ignore
          }
        })
      } catch {
        // ignore
      }

      // Set default mouth form & resize
      try {
        this.model.internalModel?.coreModel?.setParameterValueById?.('ParamMouthForm', 1)
      } catch {
        // ignore
      }

      this.resize()
      this.startBlinking()
      this.startBreathing()
      return true
    } catch (err) {
      console.warn('[Live2D] Failed to load model:', targetUrl, err)
      return false
    }
  }

  resize(): void {
    if (!this.model || !this.app) return
    const width = this.app.renderer?.width || this.app.view?.width || 320
    const height = this.app.renderer?.height || this.app.view?.height || 380

    const origWidth = this.model.internalModel?.width || this.model.width || 1
    const origHeight = this.model.internalModel?.height || this.model.height || 1

    const baseScale = Math.min(width / origWidth, height / origHeight) * 0.95
    const scale = baseScale * this.zoom
    this.model.scale.set(scale, scale)
    if (this.model.anchor?.set) {
      this.model.anchor.set(0.5, 0.5)
    }
    this.model.position.set(width / 2 + this.panX, height / 2 + 10 + this.panY)
  }

  setMouthOpenY(value: number): void {
    const clamped = Math.max(0, Math.min(1, value))
    this.currentMouthOpenY = clamped
    if (!this.model?.internalModel?.coreModel) return
    try {
      this.model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', clamped)
    } catch {
      // Model might not expose ParamMouthOpenY
    }
  }

  setEyeParameters(blinkValue: number): void {
    if (!this.model?.internalModel?.coreModel) return
    try {
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', blinkValue)
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeROpen', blinkValue)
    } catch {
      // ignore
    }
  }

  setGaze(targetX: number, targetY: number): void {
    if (!this.model?.internalModel?.coreModel) return
    try {
      // targetX, targetY normalized -1 to +1
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeBallX', targetX)
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeBallY', targetY)
      this.model.internalModel.coreModel.setParameterValueById('ParamAngleX', targetX * 15)
      this.model.internalModel.coreModel.setParameterValueById('ParamAngleY', targetY * 15)
    } catch {
      // ignore
    }
  }

  blink(): void {
    let blinkValue = 1
    const blinkSpeed = 0.15
    const closeInterval = setInterval(() => {
      blinkValue -= blinkSpeed
      if (blinkValue <= 0) {
        blinkValue = 0
        clearInterval(closeInterval)
        setTimeout(() => {
          const openInterval = setInterval(() => {
            blinkValue += blinkSpeed
            if (blinkValue >= 1) {
              blinkValue = 1
              clearInterval(openInterval)
            }
            this.setEyeParameters(blinkValue)
          }, 16)
        }, 80)
      }
      this.setEyeParameters(blinkValue)
    }, 16)
  }

  startBlinking(): void {
    this.stopBlinking()
    const scheduleNext = (): void => {
      const delay = Math.random() * 3500 + 2000
      this.blinkTimer = setTimeout(() => {
        this.blink()
        scheduleNext()
      }, delay)
    }
    scheduleNext()
  }

  stopBlinking(): void {
    if (this.blinkTimer) {
      clearTimeout(this.blinkTimer)
      this.blinkTimer = null
    }
  }

  startBreathing(): void {
    this.stopBreathing()
    this.breathTimer = setInterval(() => {
      if (!this.model?.internalModel?.coreModel) return
      this.breathAngle += 0.05
      const breathVal = Math.sin(this.breathAngle) * 0.5 + 0.5
      try {
        this.model.internalModel.coreModel.setParameterValueById('ParamBreath', breathVal)
      } catch {
        // ignore
      }
    }, 40)
  }

  stopBreathing(): void {
    if (this.breathTimer) {
      clearInterval(this.breathTimer)
      this.breathTimer = null
    }
  }

  destroy(): void {
    this.stopBlinking()
    this.stopBreathing()
    if (this.model && this.app?.stage) {
      try {
        this.app.stage.removeChild(this.model)
        this.model.destroy()
      } catch {
        // ignore
      }
      this.model = null
    }
  }
}
