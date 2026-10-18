import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Plus, RotateCcw, X } from 'lucide-react'
import {
  DEFAULT_WAKE_WORDS,
  type VoiceError,
  type VoiceSettings as Preferences,
  type VoiceState
} from '@shared/voice'
import { api } from '../lib/api'
import { recordKeybindFromEvent } from '../lib/keybind'
import { Button, Input, Switch } from './ui'

/**
 * Fork additions to upstream's Voice Translation panel: hold-to-talk, auto-send
 * and the wake word. Kept out of VoiceSettings.tsx so upstream merges stay clean.
 */
export function VoiceHandsFree({
  state,
  disabled,
  update,
  onError
}: {
  state: VoiceState
  disabled: boolean
  update: (patch: Partial<Preferences>) => Promise<void>
  onError: (error: VoiceError) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [holdKey, setHoldKey] = useState(state.settings.holdKey)
  const [newPhrase, setNewPhrase] = useState('')
  const [sampling, setSampling] = useState(false)
  const [sample, setSample] = useState<string | null>(null)
  useEffect(() => {
    setHoldKey(state.settings.holdKey)
  }, [state.settings.holdKey])
  const ready =
    state.supported && !!state.settings.modelId && state.installed.includes(state.settings.modelId)

  /** Hear how the model spells the user's wake phrase and add that spelling. */
  const recordSample = async (): Promise<void> => {
    if (sampling) return
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
            onError(result.error)
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

  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 rounded-xl border border-border p-4 disabled:opacity-50"
    >
      <legend className="px-1 text-xs font-semibold text-text-subtle">
        {t('voice.handsFree')}
      </legend>
      <label className="block space-y-1.5 text-xs text-text-muted">
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
      <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
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
  )
}
