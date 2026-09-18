import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Music, Pause, Play, Repeat, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { cn } from '../lib/cn'

interface AudioPreviewProps {
  src: string
  name: string
  path: string
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AudioPreview({ src, name, path }: AudioPreviewProps): JSX.Element {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [loop, setLoop] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [error, setError] = useState(false)

  const ext = (name.split('.').pop() || 'audio').toUpperCase()

  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setError(false)
    if (audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.playbackRate = playbackRate
    }
  }, [src])

  const togglePlay = (): void => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
    } else {
      void audio.play()
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const time = Number(e.target.value)
    setCurrentTime(time)
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }

  const handleSkip = (deltaSeconds: number): void => {
    const audio = audioRef.current
    if (!audio) return
    const target = Math.max(0, Math.min(duration || Infinity, audio.currentTime + deltaSeconds))
    audio.currentTime = target
    setCurrentTime(target)
  }

  const toggleMute = (): void => {
    const next = !muted
    setMuted(next)
    if (audioRef.current) {
      audioRef.current.muted = next
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = Number(e.target.value)
    setVolume(val)
    if (muted && val > 0) setMuted(false)
    if (audioRef.current) {
      audioRef.current.volume = val
      audioRef.current.muted = val === 0
    }
  }

  const cycleSpeed = (): void => {
    const speeds = [0.5, 1, 1.25, 1.5, 2]
    const idx = speeds.indexOf(playbackRate)
    const next = speeds[(idx + 1) % speeds.length]
    setPlaybackRate(next)
    if (audioRef.current) {
      audioRef.current.playbackRate = next
    }
  }

  const toggleLoop = (): void => {
    const next = !loop
    setLoop(next)
    if (audioRef.current) {
      audioRef.current.loop = next
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-auto p-6 select-none bg-bg/40">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
        onError={() => setError(true)}
      />

      {error ? (
        <div className="flex flex-col items-center gap-3 text-danger max-w-sm text-center">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm font-medium">{t('ide.audioLoadError')}</p>
          <span className="font-mono text-xs text-text-subtle">{path}</span>
        </div>
      ) : (
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border/80 bg-surface/90 p-8 shadow-2xl backdrop-blur-md">
          {/* Animated Album / Soundwave Artwork */}
          <div className="relative flex h-32 w-32 items-center justify-center rounded-2xl border border-border/60 bg-gradient-to-br from-violet-500/10 via-surface-2 to-surface shadow-inner">
            <div
              className={cn(
                'absolute inset-2 rounded-xl border border-violet-500/20 transition-all duration-700',
                isPlaying && 'scale-105 border-violet-500/40 shadow-lg shadow-violet-500/10'
              )}
            />
            {isPlaying ? (
              <div className="flex items-end gap-1.5 h-12">
                <span className="w-1 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.4s] h-8" />
                <span className="w-1 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.2s] h-12" />
                <span className="w-1 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.5s] h-6" />
                <span className="w-1 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.1s] h-10" />
                <span className="w-1 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.3s] h-7" />
              </div>
            ) : (
              <Music className="h-12 w-12 text-violet-400/80 transition-transform duration-300" />
            )}
            <span className="absolute bottom-2 right-2 rounded bg-surface-3/90 border border-border/60 px-1.5 py-0.5 font-mono text-[9px] font-bold text-violet-400 tracking-wider">
              {ext}
            </span>
          </div>

          {/* Title & Info */}
          <div className="flex flex-col items-center text-center gap-1 w-full min-w-0">
            <h3 className="truncate max-w-full text-sm font-semibold text-text" title={name}>
              {name}
            </h3>
            <span
              className="truncate max-w-full font-mono text-[11px] text-text-subtle"
              title={path}
            >
              {path}
            </span>
          </div>

          {/* Timeline / Progress scrubber */}
          <div className="flex w-full flex-col gap-1.5">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-violet-400 transition-all hover:h-2"
            />
            <div className="flex w-full justify-between font-mono text-[11px] text-text-subtle">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex w-full items-center justify-between pt-1">
            {/* Loop Toggle */}
            <button
              type="button"
              onClick={toggleLoop}
              title={t('ide.loop')}
              aria-label={t('ide.loop')}
              className={cn(
                'press-scale flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                loop
                  ? 'bg-violet-500/20 text-violet-400'
                  : 'text-text-subtle hover:bg-surface-2 hover:text-text'
              )}
            >
              <Repeat className="h-4 w-4" />
            </button>

            {/* Main playback buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleSkip(-5)}
                title="-5s"
                aria-label="Rewind 5 seconds"
                className="press-scale flex h-8 w-8 items-center justify-center rounded-lg text-text-subtle hover:bg-surface-2 hover:text-text transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                title={isPlaying ? t('ide.pause') : t('ide.play')}
                aria-label={isPlaying ? t('ide.pause') : t('ide.play')}
                className="press-scale flex h-12 w-12 items-center justify-center rounded-full bg-violet-500 text-white shadow-lg shadow-violet-500/25 hover:bg-violet-400 transition-all hover:scale-105 active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5 fill-current" />
                ) : (
                  <Play className="h-5 w-5 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSkip(5)}
                title="+5s"
                aria-label="Forward 5 seconds"
                className="press-scale flex h-8 w-8 items-center justify-center rounded-lg text-text-subtle hover:bg-surface-2 hover:text-text transition-colors"
              >
                <RotateCcw className="h-4 w-4 -scale-x-100" />
              </button>
            </div>

            {/* Playback speed pill */}
            <button
              type="button"
              onClick={cycleSpeed}
              title="Playback speed"
              className="press-scale flex h-8 px-2 items-center justify-center rounded-lg font-mono text-[11px] font-semibold text-text-subtle hover:bg-surface-2 hover:text-text transition-colors"
            >
              {playbackRate}x
            </button>
          </div>

          {/* Volume Control Row */}
          <div className="flex w-full items-center justify-center gap-2 border-t border-border/40 pt-4">
            <button
              type="button"
              onClick={toggleMute}
              title={muted || volume === 0 ? t('ide.unmute') : t('ide.mute')}
              aria-label={muted || volume === 0 ? t('ide.unmute') : t('ide.mute')}
              className="text-text-subtle hover:text-text transition-colors"
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={handleVolumeChange}
              className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-surface-2 accent-violet-400 transition-all"
            />
          </div>
        </div>
      )}
    </div>
  )
}
