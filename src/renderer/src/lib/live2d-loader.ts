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

// Mouth smile ("corners") tuning.
// ParamMouthForm 1 = full smile (corners pulled up). When the mouth is closed
// a full smile reads as unnaturally high, so we scale it down at rest.
const MOUTH_FORM_MAX = 0.55 // smile amount when mouth is open/speaking
const MOUTH_FORM_MIN = 0 // smile amount when mouth is closed (0 = flat)

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
  private followCursor = true
  private isHeadpatting = false
  private headpatWeight = 0
  private headpatTime = 0
  private headpatOffset = { x: 0, y: 0 }
  private headpatAngleX = 0
  private headpatAngleY = 0
  private headpatAngleZ = 0
  private headpatEndTimer: any = null
  private isPoking = false
  private pokeWeight = 0
  private pokeTime = 0
  private pokeOffset = { x: 0, y: 0 }
  private pokeBodyAngleX = 0
  private pokeBodyAngleZ = 0
  private pokeEndTimer: any = null
  private onHeadMoveCallback:
    | ((pos: { x: number; y: number; width: number; height: number }) => void)
    | null = null

  constructor(app: any, modelPath: string) {
    this.app = app
    this.modelPath = modelPath
  }

  setOnHeadMove(
    callback: ((pos: { x: number; y: number; width: number; height: number }) => void) | null
  ): void {
    this.onHeadMoveCallback = callback
    this.notifyHeadPosition()
  }

  notifyHeadPosition(): void {
    if (!this.onHeadMoveCallback) return
    const pos = this.getHeadPosition()
    this.onHeadMoveCallback(pos)
  }

  getHeadPosition(): { x: number; y: number; width: number; height: number } {
    const width = this.app?.renderer?.width || this.app?.view?.width || 340
    const height = this.app?.renderer?.height || this.app?.view?.height || 440

    if (this.model) {
      try {
        const bounds = this.model.getBounds()
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          return {
            x: bounds.x + bounds.width * 0.5,
            y: bounds.y,
            width: Math.min(bounds.width * 0.45, bounds.width),
            height: bounds.height * 0.25
          }
        }
      } catch {
        // fallback
      }
    }

    const origWidth = this.model?.internalModel?.width || this.model?.width || 1000
    const origHeight = this.model?.internalModel?.height || this.model?.height || 1400
    const headroom = 55
    const availableHeight = Math.max(100, height - headroom)
    const baseScale = Math.min(width / origWidth, availableHeight / origHeight) * 0.95
    const scale = baseScale * this.zoom
    const centerX = width / 2 + this.panX
    const modelTopY = headroom + availableHeight / 2 + this.panY - origHeight * scale * 0.5
    return {
      x: centerX,
      y: modelTopY,
      width: origWidth * scale * 0.4,
      height: origHeight * scale * 0.25
    }
  }

  isHeadHit(localX: number, localY: number): boolean {
    const head = this.getHeadPosition()
    const dx = Math.abs(localX - head.x)
    const halfWidth = Math.max(35, head.width * 0.6)
    if (dx > halfWidth) return false
    if (localY < head.y - 25 || localY > head.y + head.height * 1.25) return false
    return true
  }

  private computeHeadpatOffset(x: number, y: number): void {
    const head = this.getHeadPosition()
    const spanX = Math.max(30, head.width * 0.45)
    const spanY = Math.max(30, head.height * 0.45)
    const centerY = head.y + head.height * 0.5
    this.headpatOffset = {
      x: Math.max(-1.5, Math.min(1.5, (x - head.x) / spanX)),
      y: Math.max(-1.5, Math.min(1.5, (y - centerY) / spanY))
    }
  }

  startHeadpat(initialX?: number, initialY?: number): void {
    if (this.headpatEndTimer) {
      clearTimeout(this.headpatEndTimer)
      this.headpatEndTimer = null
    }
    this.isHeadpatting = true
    if (initialX !== undefined && initialY !== undefined) {
      this.computeHeadpatOffset(initialX, initialY)
    } else {
      this.headpatOffset = { x: 0, y: 0 }
    }

    const fc = this.model?.internalModel?.focusController
    if (fc) {
      fc.focus?.(0, 0, true)
      fc.x = 0
      fc.y = 0
      fc.vx = 0
      fc.vy = 0
    }
  }

  updateHeadpat(currentX: number, currentY: number): void {
    if (!this.isHeadpatting) return
    this.computeHeadpatOffset(currentX, currentY)
  }

  endHeadpat(): void {
    if (this.headpatEndTimer) {
      clearTimeout(this.headpatEndTimer)
      this.headpatEndTimer = null
    }
    this.isHeadpatting = false
  }

  pulseHeadpat(durationMs = 1400, clickX?: number, clickY?: number): void {
    this.startHeadpat(clickX, clickY)
    if (Math.abs(this.headpatOffset.x) < 0.15) {
      this.headpatOffset.x = 0.35
    }
    this.headpatEndTimer = setTimeout(() => {
      this.endHeadpat()
    }, durationMs)
  }

  getIsHeadpatting(): boolean {
    return this.isHeadpatting || this.headpatWeight > 0.05
  }

  /** Chest region sits below the head, roughly the upper torso of the model. */
  getChestPosition(): { x: number; y: number; width: number; height: number } {
    if (this.model) {
      try {
        const bounds = this.model.getBounds()
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          return {
            x: bounds.x + bounds.width * 0.5,
            y: bounds.y + bounds.height * 0.36,
            width: bounds.width * 0.4,
            height: bounds.height * 0.16
          }
        }
      } catch {
        // fallback
      }
    }

    const head = this.getHeadPosition()
    return {
      x: head.x,
      y: head.y + head.height * 2.3,
      width: head.width * 1.25,
      height: head.height * 0.95
    }
  }

  isChestHit(localX: number, localY: number): boolean {
    const chest = this.getChestPosition()
    const dx = Math.abs(localX - chest.x)
    const halfWidth = Math.max(30, chest.width * 0.5)
    if (dx > halfWidth) return false
    if (localY < chest.y - chest.height * 0.3 || localY > chest.y + chest.height * 1.3) return false
    return true
  }

  private computePokeOffset(x: number, y: number): void {
    const chest = this.getChestPosition()
    const spanX = Math.max(30, chest.width * 0.5)
    const spanY = Math.max(30, chest.height * 0.6)
    this.pokeOffset = {
      x: Math.max(-1.5, Math.min(1.5, (x - chest.x) / spanX)),
      y: Math.max(-1.5, Math.min(1.5, (y - chest.y) / spanY))
    }
  }

  startPoke(initialX?: number, initialY?: number): void {
    if (this.pokeEndTimer) {
      clearTimeout(this.pokeEndTimer)
      this.pokeEndTimer = null
    }
    this.isPoking = true
    if (initialX !== undefined && initialY !== undefined) {
      this.computePokeOffset(initialX, initialY)
    } else {
      this.pokeOffset = { x: 0, y: 0 }
    }

    // Release any cursor-following focus so the poke reaction fully controls the body
    const fc = this.model?.internalModel?.focusController
    if (fc) {
      fc.focus?.(0, 0, true)
      fc.x = 0
      fc.y = 0
      fc.vx = 0
      fc.vy = 0
    }
  }

  updatePoke(currentX: number, currentY: number): void {
    if (!this.isPoking) return
    this.computePokeOffset(currentX, currentY)
  }

  endPoke(): void {
    if (this.pokeEndTimer) {
      clearTimeout(this.pokeEndTimer)
      this.pokeEndTimer = null
    }
    this.isPoking = false
  }

  pulsePoke(durationMs = 1200, clickX?: number, clickY?: number): void {
    this.startPoke(clickX, clickY)
    if (Math.abs(this.pokeOffset.x) < 0.15) {
      this.pokeOffset.x = this.pokeOffset.x >= 0 ? 0.4 : -0.4
    }
    this.pokeEndTimer = setTimeout(() => {
      this.endPoke()
    }, durationMs)
  }

  getIsPoking(): boolean {
    return this.isPoking || this.pokeWeight > 0.05
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
    const headroom = 55
    const availableHeight = Math.max(100, height - headroom)

    if (cx !== undefined && cy !== undefined) {
      const baseCenterX = width / 2
      const baseCenterY = headroom + availableHeight / 2
      this.panX = cx - baseCenterX - (cx - baseCenterX - this.panX) * ratio
      this.panY = cy - baseCenterY - (cy - baseCenterY - this.panY) * ratio
    } else {
      this.panX *= ratio
      this.panY *= ratio
    }

    this.zoom = newZoom
    this.resize()
    this.notifyHeadPosition()
  }

  pan(dx: number, dy: number): void {
    this.panX += dx
    this.panY += dy
    this.resize()
    this.notifyHeadPosition()
  }

  resetZoomAndPan(): void {
    this.zoom = 1.0
    this.panX = 0
    this.panY = 0
    this.resize()
    this.notifyHeadPosition()
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

      this.model = await w.PIXI.live2d.Live2DModel.from(targetUrl, {
        autoInteract: this.followCursor
      })
      this.app.stage.addChild(this.model)

      if (!this.followCursor) {
        this.setFollowCursor(false)
      }

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
              // Lower the smile (mouth corners) when the mouth is closed so the
              // resting face looks natural; scale up as she opens her mouth.
              const mouthFormT = Math.min(1, Math.max(0, this.currentMouthOpenY / 0.6))
              core.setParameterValueById?.(
                'ParamMouthForm',
                MOUTH_FORM_MIN + (MOUTH_FORM_MAX - MOUTH_FORM_MIN) * mouthFormT
              )

              // Update headpat transition weight and animation time
              if (this.isHeadpatting) {
                this.headpatWeight = Math.min(1, this.headpatWeight + 0.08)
                this.headpatTime += 0.025
              } else if (this.headpatWeight > 0) {
                this.headpatWeight = Math.max(0, this.headpatWeight - 0.03)
                this.headpatTime += 0.015
                // Relax offset towards center when pointer released
                this.headpatOffset.x *= 0.94
                this.headpatOffset.y *= 0.94
              }

              if (this.headpatWeight > 0.001) {
                const w = this.headpatWeight

                // Head movement directly relative to mouse position across the head
                // Mouse left -> head turns left (negative angle); mouse right -> head turns right (positive angle)
                const subtleBreathing = Math.sin(this.headpatTime * 2.5) * 0.6
                const targetAngleX = this.headpatOffset.x * 12.0
                const targetAngleZ = this.headpatOffset.x * 6.5 + subtleBreathing
                const targetAngleY = -2.0 + this.headpatOffset.y * 3.5

                // Smoothly and slowly interpolate towards target relative to mouse
                const lerpFactor = 0.06
                this.headpatAngleX += (targetAngleX - this.headpatAngleX) * lerpFactor
                this.headpatAngleY += (targetAngleY - this.headpatAngleY) * lerpFactor
                this.headpatAngleZ += (targetAngleZ - this.headpatAngleZ) * lerpFactor

                const curAngleX = core.getParameterValueById?.('ParamAngleX') ?? 0
                const curAngleY = core.getParameterValueById?.('ParamAngleY') ?? 0
                const curAngleZ = core.getParameterValueById?.('ParamAngleZ') ?? 0

                core.setParameterValueById?.(
                  'ParamAngleX',
                  curAngleX * (1 - w) + this.headpatAngleX * w
                )
                core.setParameterValueById?.(
                  'ParamAngleY',
                  curAngleY * (1 - w) + this.headpatAngleY * w
                )
                core.setParameterValueById?.(
                  'ParamAngleZ',
                  curAngleZ * (1 - w) + this.headpatAngleZ * w
                )

                // Ensure entire body stays completely stationary (no whole-model shaking)
                const curBodyX = core.getParameterValueById?.('ParamBodyAngleX') ?? 0
                const curBodyY = core.getParameterValueById?.('ParamBodyAngleY') ?? 0
                const curBodyZ = core.getParameterValueById?.('ParamBodyAngleZ') ?? 0
                core.setParameterValueById?.('ParamBodyAngleX', curBodyX * (1 - w))
                core.setParameterValueById?.('ParamBodyAngleY', curBodyY * (1 - w))
                core.setParameterValueById?.('ParamBodyAngleZ', curBodyZ * (1 - w))

                // Eyeballs: gently follow head turn relative to mouse
                const curEyeX = core.getParameterValueById?.('ParamEyeBallX') ?? 0
                const curEyeY = core.getParameterValueById?.('ParamEyeBallY') ?? 0
                core.setParameterValueById?.(
                  'ParamEyeBallX',
                  curEyeX * (1 - w) + (this.headpatAngleX / 28) * w
                )
                core.setParameterValueById?.('ParamEyeBallY', curEyeY * (1 - w) + 0.15 * w)

                // Cheeks blush
                const curCheek = core.getParameterValueById?.('ParamCheek') ?? 0
                core.setParameterValueById?.('ParamCheek', Math.max(curCheek, 0.75 * w))

                // Squinting happy smile
                const curSmileL = core.getParameterValueById?.('ParamEyeLSmile') ?? 0
                const curSmileR = core.getParameterValueById?.('ParamEyeRSmile') ?? 0
                core.setParameterValueById?.('ParamEyeLSmile', Math.max(curSmileL, 1.0 * w))
                core.setParameterValueById?.('ParamEyeRSmile', Math.max(curSmileR, 1.0 * w))

                // Eyes close completely during headpats
                core.setParameterValueById?.('ParamEyeLOpen', Math.max(0, 1 - w))
                core.setParameterValueById?.('ParamEyeROpen', Math.max(0, 1 - w))
              } else {
                this.headpatAngleX = 0
                this.headpatAngleY = 0
                this.headpatAngleZ = 0
                core.setParameterValueById?.('ParamEyeLOpen', 1)
                core.setParameterValueById?.('ParamEyeROpen', 1)
                core.setParameterValueById?.('ParamEyeLSmile', 0)
                core.setParameterValueById?.('ParamEyeRSmile', 0)
                core.setParameterValueById?.('ParamCheek', 0)
                if (!this.followCursor) {
                  core.setParameterValueById?.('ParamEyeBallX', 0)
                  core.setParameterValueById?.('ParamEyeBallY', 0)
                  core.setParameterValueById?.('ParamAngleX', 0)
                  core.setParameterValueById?.('ParamAngleY', 0)
                  core.setParameterValueById?.('ParamBodyAngleX', 0)
                }
              }

              // Chest poke: squirm reaction relative to the mouse, like headpats
              if (this.isPoking) {
                this.pokeWeight = Math.min(1, this.pokeWeight + 0.08)
                this.pokeTime += 0.025
              } else if (this.pokeWeight > 0) {
                this.pokeWeight = Math.max(0, this.pokeWeight - 0.03)
                this.pokeTime += 0.015
                this.pokeOffset.x *= 0.94
                this.pokeOffset.y *= 0.94
              }

              if (this.pokeWeight > 0.001) {
                const w = this.pokeWeight

                // Subtle breathing/wriggle so she never looks frozen
                const squirm = Math.sin(this.pokeTime * 2.5) * 0.6

                // Body follows the mouse across the chest (mirrors headpat head-turn),
                // leaning away from the poke point, with a gentle wriggle.
                const targetBodyX = this.pokeOffset.x * 9.0
                const targetBodyZ = this.pokeOffset.x * 4.5 + squirm

                const lerpFactor = 0.06
                this.pokeBodyAngleX += (targetBodyX - this.pokeBodyAngleX) * lerpFactor
                this.pokeBodyAngleZ += (targetBodyZ - this.pokeBodyAngleZ) * lerpFactor

                const curBodyX = core.getParameterValueById?.('ParamBodyAngleX') ?? 0
                const curBodyZ = core.getParameterValueById?.('ParamBodyAngleZ') ?? 0
                core.setParameterValueById?.(
                  'ParamBodyAngleX',
                  curBodyX * (1 - w) + this.pokeBodyAngleX * w
                )
                core.setParameterValueById?.(
                  'ParamBodyAngleZ',
                  curBodyZ * (1 - w) + this.pokeBodyAngleZ * w
                )

                // Head turns/tilts relative to the mouse along with the body
                const curAngleX = core.getParameterValueById?.('ParamAngleX') ?? 0
                const curAngleY = core.getParameterValueById?.('ParamAngleY') ?? 0
                const curAngleZ = core.getParameterValueById?.('ParamAngleZ') ?? 0
                core.setParameterValueById?.(
                  'ParamAngleX',
                  curAngleX * (1 - w) + this.pokeOffset.x * 11.0 * w
                )
                core.setParameterValueById?.(
                  'ParamAngleY',
                  curAngleY * (1 - w) + (-2.0 + this.pokeOffset.y * 3.5) * w
                )
                core.setParameterValueById?.(
                  'ParamAngleZ',
                  curAngleZ * (1 - w) + this.pokeOffset.x * 5.5 * w
                )

                // Startled blush
                const curCheek = core.getParameterValueById?.('ParamCheek') ?? 0
                core.setParameterValueById?.('ParamCheek', Math.max(curCheek, 0.75 * w))
              } else {
                this.pokeBodyAngleX = 0
                this.pokeBodyAngleZ = 0
              }
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
        this.model.internalModel?.coreModel?.setParameterValueById?.('ParamMouthForm', MOUTH_FORM_MIN)
      } catch {
        // ignore
      }

      this.resize()
      this.notifyHeadPosition()
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

    const headroom = 55
    const availableHeight = Math.max(100, height - headroom)
    const baseScale = Math.min(width / origWidth, availableHeight / origHeight) * 0.95
    const scale = baseScale * this.zoom
    this.model.scale.set(scale, scale)
    if (this.model.anchor?.set) {
      this.model.anchor.set(0.5, 0.5)
    }
    this.model.position.set(width / 2 + this.panX, headroom + availableHeight / 2 + this.panY)
    this.notifyHeadPosition()
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
    if (this.headpatWeight > 0.01 || this.isHeadpatting) return
    try {
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', blinkValue)
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeROpen', blinkValue)
    } catch {
      // ignore
    }
  }

  setGaze(targetX: number, targetY: number): void {
    if (!this.model?.internalModel?.coreModel || !this.followCursor) return
    if (this.headpatWeight > 0.05 || this.isHeadpatting) return
    try {
      if (this.model.internalModel?.focusController) {
        this.model.internalModel.focusController.focus(targetX, targetY)
      }
      // targetX, targetY normalized -1 to +1
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeBallX', targetX)
      this.model.internalModel.coreModel.setParameterValueById('ParamEyeBallY', targetY)
      this.model.internalModel.coreModel.setParameterValueById('ParamAngleX', targetX * 15)
      this.model.internalModel.coreModel.setParameterValueById('ParamAngleY', targetY * 15)
    } catch {
      // ignore
    }
  }

  setFollowCursor(enabled: boolean): void {
    this.followCursor = enabled
    if (this.model) {
      try {
        this.model.autoInteract = enabled
        this.model.interactive = enabled
        if (!enabled) {
          this.model.unregisterInteraction?.()
          const fc = this.model.internalModel?.focusController
          if (fc) {
            fc.focus?.(0, 0, true)
            fc.x = 0
            fc.y = 0
            fc.vx = 0
            fc.vy = 0
          }
          this.setGaze(0, 0)
          const core = this.model?.internalModel?.coreModel
          if (core) {
            core.setParameterValueById?.('ParamEyeBallX', 0)
            core.setParameterValueById?.('ParamEyeBallY', 0)
            core.setParameterValueById?.('ParamAngleX', 0)
            core.setParameterValueById?.('ParamAngleY', 0)
            core.setParameterValueById?.('ParamBodyAngleX', 0)
          }
        } else {
          const interaction = this.app?.renderer?.plugins?.interaction || this.app?.renderer?.events
          if (interaction) {
            this.model.registerInteraction?.(interaction)
          }
        }
      } catch {
        // ignore
      }
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
    this.endHeadpat()
    this.endPoke()
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
