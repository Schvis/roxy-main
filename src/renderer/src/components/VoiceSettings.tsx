import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AudioLines,
  Check,
  Download,
  Globe,
  HardDrive,
  Mic,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import {
  DEFAULT_WAKE_WORDS,
  VOICE_MODELS,
  type VoiceDevice,
  type VoiceError,
  type VoiceResult,
  type VoiceSettings as Preferences
} from '@shared/voice'
import { api } from '../lib/api'
import { useVoiceState } from '../lib/voice'
import { recordKeybindFromEvent } from '../lib/keybind'
import { Button, Input, Switch } from './ui'
import { cn } from '../lib/cn'

export function VoiceSettings(): JSX.Element {
  const { t } = useTranslation()
  const state = useVoiceState()
  const [devices, setDevices] = useState<VoiceDevice[]>([])
  const [hotkeys, setHotkeys] = useState<[string, string]>(['', ''])
  const [search, setSearch] = useState('')
  const [language, setLanguage] = useState('all')
  const [error, setError] = useState<VoiceError | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [holdKey, setHoldKey] = useState('')
  const [newPhrase, setNewPhrase] = useState('')
  const [sampling, setSampling] = useState(false)
  const [sample, setSample] = useState<string | null>(null)
  useEffect(() => {
    if (state) setHotkeys(state.settings.hotkeys)
  }, [state?.settings.hotkeys.join('|')])
  useEffect(() => {
    if (state) setHoldKey(state.settings.holdKey)
  }, [state?.settings.holdKey])

  /** Hear how the model spells the user's wake phrase and add that spelling. */
  const recordSample = async (): Promise<void> => {
    if (!state || sampling) return
    setSampling(true)
    setSample(null)
    const id = crypto.randomUUID()
    const heard = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => done(null), 8000)
      const off = api.voice.onEvent((event) => {
        if (event.type === 'utterance' && event.listenerId === id) done(event.text)
        else if (event.type === 'listener' && event.listenerId === id && event.phase === 'stopped')
          done(null)
      })
      function done(text: string | null): void {
        clearTimeout(timer)
        off()
        void api.voice.unlisten(id).catch(() => undefined)
        resolve(text)
      }
      void api.voice
        .listen(id)
        .then((result) => {
          if (!result.ok) {
            setError(result.error)
            done(null)
          }
        })
        .catch(() => done(null))
    })
    const phrase = heard
      ?.toLowerCase()
      .replace(/[.,!?;:]/g, '')
      .trim()
    if (phrase) {
      if (!state.settings.wakeWords.includes(phrase))
        await update({ wakeWords: [...state.settings.wakeWords, phrase] })
      setSample(t('voice.sampleHeard', { text: phrase }))
    } else setSample(t('voice.sampleNoSpeech'))
    setSampling(false)
  }

  const result = async (operation: Promise<VoiceResult<unknown>>): Promise<void> => {
    setError(null)
    try {
      const response = await operation
      if (!response.ok) setError(response.error)
    } catch {
      setError('unknown')
    }
  }
  const update = async (patch: Partial<Preferences>): Promise<void> => {
    if (busy) return
    setBusy(true)
    await result(api.voice.update(patch))
    setBusy(false)
  }
  const refreshDevices = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const response = await api.voice.devices()
      if (response.ok) setDevices(response.value)
      else setError(response.error)
    } catch {
      setError('deviceUnavailable')
    } finally {
      setBusy(false)
    }
  }
  if (!state)
    return (
      <p role="status" className="text-sm text-text-muted">
        {t('voice.loading')}
      </p>
    )
  const enabled = state.settings.enabled
  const shown = VOICE_MODELS.filter(
    (model) =>
      model.name.toLowerCase().includes(search.toLowerCase()) &&
      (language === 'all' || (language === 'multi' ? model.multilingual : !model.multilingual))
  )
  const issue = error ?? state.error
  const selectedMic = state.settings.microphone
  const ready =
    state.supported && !!state.settings.modelId && state.installed.includes(state.settings.modelId)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface p-4">
        <div>
          <h2 className="text-sm font-semibold text-text">{t('voice.heading')}</h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-muted">
            {t('voice.description')}
          </p>
        </div>
        <div role="group" aria-label={t('voice.heading')} className="shrink-0">
          <Switch
            label={t('voice.heading')}
            checked={enabled}
            disabled={busy || !state.supported}
            onChange={(value) => void update({ enabled: value })}
          />
        </div>
      </div>
      {!state.supported && (
        <p role="alert" className="text-xs text-danger">
          {t('voice.errors.unsupported')}
        </p>
      )}
      {issue && (
        <p role="alert" className="text-xs text-danger">
          {t(`voice.errors.${issue}`)}
        </p>
      )}

      <fieldset
        disabled={!enabled || busy}
        className="space-y-4 rounded-xl border border-border p-4 disabled:opacity-50"
      >
        <legend className="px-1 text-xs font-semibold text-text-subtle">
          {t('voice.microphone')}
        </legend>
        <p className="text-xs leading-relaxed text-text-muted">{t('voice.microphoneBody')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Mic className="h-4 w-4 text-text-muted" aria-hidden />
          <label htmlFor="voice-microphone" className="sr-only">
            {t('voice.microphone')}
          </label>
          <select
            id="voice-microphone"
            value={selectedMic?.id ?? ''}
            onChange={(event) => {
              const device = devices.find((d) => d.id === event.target.value)
              void update({
                microphone: device
                  ? { id: device.id, name: device.name, occurrence: device.occurrence }
                  : null
              })
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
          >
            <option value="">{t('voice.systemDefault')}</option>
            {selectedMic && !devices.some((d) => d.id === selectedMic.id) && (
              <option value={selectedMic.id}>{selectedMic.name}</option>
            )}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.occurrence
                  ? t('voice.deviceDuplicate', { name: device.name, number: device.occurrence + 1 })
                  : device.name}
              </option>
            ))}
          </select>
          <Button onClick={() => void refreshDevices()} title={t('voice.refreshDevices')}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('voice.refreshDevices')}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          {t('voice.permission', {
            status: t(
              `voice.permissions.${(['granted', 'denied', 'restricted', 'not-determined'].includes(state.permission) ? state.permission : 'unknown') as 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'}`
            )
          })}
        </p>
        <Button size="sm" onClick={() => void api.voice.privacy()}>
          {t('voice.openPrivacy')}
        </Button>
        <p className="text-xs leading-relaxed text-text-subtle">{t('voice.bluetooth')}</p>
      </fieldset>

      <fieldset
        disabled={!enabled || busy}
        className="space-y-3 rounded-xl border border-border p-4 disabled:opacity-50"
      >
        <legend className="px-1 text-xs font-semibold text-text-subtle">
          {t('voice.hotkeys')}
        </legend>
        <p className="text-xs leading-relaxed text-text-muted">{t('voice.hotkeysBody')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([0, 1] as const).map((index) => (
            <label key={index} className="space-y-1.5 text-xs text-text-muted">
              <span>{t('voice.hotkeyNumber', { number: index + 1 })}</span>
              <Input
                value={hotkeys[index]}
                placeholder="CommandOrControl+Shift+Space"
                spellCheck={false}
                onChange={(event) =>
                  setHotkeys((previous) =>
                    index === 0
                      ? [event.target.value, previous[1]]
                      : [previous[0], event.target.value]
                  )
                }
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-text-subtle">{t('voice.hotkeyHint')}</p>
        <Button size="sm" onClick={() => void update({ hotkeys })}>
          {t('common.save')}
        </Button>
        <label className="block space-y-1.5 border-t border-border pt-3 text-xs text-text-muted">
          <span className="font-medium text-text">{t('voice.holdKey')}</span>
          <span className="block leading-relaxed">{t('voice.holdKeyBody')}</span>
          <Input
            value={holdKey}
            readOnly
            placeholder={t('voice.holdKeyPlaceholder')}
            spellCheck={false}
            className="sm:max-w-xs"
            onKeyDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Backspace' || event.key === 'Delete') {
                setHoldKey('')
                void update({ holdKey: '' })
                return
              }
              const recorded = recordKeybindFromEvent(event)
              setHoldKey(recorded.keybind)
              if (recorded.finished) {
                void update({ holdKey: recorded.keybind })
                event.currentTarget.blur()
              }
            }}
            onBlur={() => setHoldKey(state.settings.holdKey)}
          />
        </label>
      </fieldset>

      <fieldset
        disabled={!enabled || busy}
        className="space-y-3 rounded-xl border border-border p-4 disabled:opacity-50"
      >
        <legend className="px-1 text-xs font-semibold text-text-subtle">
          {t('voice.handsFree')}
        </legend>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text">{t('voice.autoSend')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
              {t('voice.autoSendBody')}
            </p>
          </div>
          <Switch
            label={t('voice.autoSend')}
            checked={state.settings.autoSend}
            onChange={(value) => void update({ autoSend: value })}
          />
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
          <div>
            <p className="text-sm font-medium text-text">{t('voice.wakeWord')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
              {t('voice.wakeWordBody')}
            </p>
          </div>
          <Switch
            label={t('voice.wakeWord')}
            checked={state.settings.wakeWord}
            onChange={(value) => void update({ wakeWord: value })}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-muted">{t('voice.wakePhrases')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {state.settings.wakeWords.map((phrase) => (
              <li
                key={phrase}
                className="flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pl-2 pr-1 text-xs text-text"
              >
                {phrase}
                <button
                  type="button"
                  aria-label={t('voice.removePhrase', { phrase })}
                  title={t('voice.removePhrase', { phrase })}
                  onClick={() =>
                    void update({
                      wakeWords: state.settings.wakeWords.filter((w) => w !== phrase)
                    })
                  }
                  className="rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const phrase = newPhrase.trim().toLowerCase()
              if (phrase) void update({ wakeWords: [...state.settings.wakeWords, phrase] })
              setNewPhrase('')
            }}
          >
            <Input
              value={newPhrase}
              onChange={(event) => setNewPhrase(event.target.value)}
              placeholder={t('voice.addPhrasePlaceholder')}
              aria-label={t('voice.addPhrasePlaceholder')}
              className="min-w-0 flex-1"
            />
            <Button size="sm" type="submit" disabled={!newPhrase.trim()}>
              <Plus className="h-3.5 w-3.5" />
              {t('voice.addPhrase')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void update({ wakeWords: [...DEFAULT_WAKE_WORDS] })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('voice.resetPhrases')}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button size="sm" disabled={sampling || !ready} onClick={() => void recordSample()}>
              <Mic className="h-3.5 w-3.5" />
              {sampling ? t('voice.sampleListening') : t('voice.sample')}
            </Button>
            <p role="status" className="min-w-0 flex-1 text-xs text-text-muted">
              {sample ?? t('voice.sampleBody')}
            </p>
          </div>
        </div>
      </fieldset>

      <section aria-labelledby="voice-models-heading" className={cn(!enabled && 'opacity-50')}>
        <h2 id="voice-models-heading" className="text-sm font-semibold text-text">
          {t('voice.models')}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{t('voice.modelsBody')}</p>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-3 h-3.5 w-3.5 text-text-subtle" />
          <Input
            aria-label={t('voice.search')}
            placeholder={t('voice.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="my-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <AudioLines className="h-3.5 w-3.5" />
            {t('voice.streamingOnly')}
          </span>
          <select
            aria-label={t('voice.languages')}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-muted"
          >
            <option value="all">{t('voice.allLanguages')}</option>
            <option value="en">{t('voice.english')}</option>
            <option value="multi">{t('voice.multilingual')}</option>
          </select>
        </div>
        <div className="space-y-3">
          {shown.map((model) => {
            const downloaded = state.installed.includes(model.id)
            const active = downloaded && state.settings.modelId === model.id
            const job = state.download?.modelId === model.id ? state.download : null
            const percent = job ? Math.floor((job.received / job.total) * 100) : 0
            return (
              <article
                key={model.id}
                className={cn(
                  'rounded-xl border p-4',
                  active ? 'border-accent/60 bg-accent/5' : 'border-border bg-surface'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-text">{model.name}</h3>
                  {active && (
                    <span className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                      <Check className="h-3 w-3" />
                      {t('voice.active')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                  {t(`voice.modelDescriptions.${model.description}`)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-[11px] text-text-subtle">
                  <span className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {t(model.multilingual ? 'voice.multilingual' : 'voice.english')}
                  </span>
                  <span className="flex items-center gap-1">
                    <AudioLines className="h-3 w-3" />
                    {t('voice.streaming')}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {t('voice.size', {
                      size: Math.ceil(model.files.reduce((n, f) => n + f.bytes, 0) / 1048576)
                    })}
                  </span>
                  <button
                    className="text-left underline underline-offset-2 hover:text-text"
                    onClick={() => void api.system.openExternal(model.licenseUrl)}
                  >
                    {model.license}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {job ? (
                    <>
                      <progress
                        className="h-1.5 min-w-20 flex-1 accent-accent"
                        value={percent}
                        max={100}
                        aria-label={t('voice.downloading', { percent })}
                      />
                      <span className="text-xs text-text-muted">
                        {t('voice.downloading', { percent })}
                      </span>
                      <Button size="sm" onClick={() => void api.voice.cancelDownload()}>
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : downloaded ? (
                    <>
                      {!active && (
                        <Button
                          size="sm"
                          disabled={!enabled || busy}
                          onClick={() => void update({ modelId: model.id })}
                        >
                          {t('voice.useModel')}
                        </Button>
                      )}
                      {removing === model.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={!enabled || busy}
                            onClick={() => {
                              setRemoving(null)
                              void result(api.voice.remove(model.id))
                            }}
                          >
                            {t('voice.confirmDelete')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                            {t('common.cancel')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!enabled || busy}
                          onClick={() => setRemoving(model.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('voice.delete')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!enabled || !state.supported || !!state.download || busy}
                      onClick={() => void result(api.voice.download(model.id))}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('voice.download')}
                    </Button>
                  )}
                </div>
              </article>
            )
          })}
          {!shown.length && (
            <p className="py-6 text-center text-xs text-text-muted">{t('voice.noModels')}</p>
          )}
        </div>
      </section>
    </div>
  )
}
