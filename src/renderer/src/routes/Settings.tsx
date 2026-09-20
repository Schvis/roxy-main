import { IdeChatDock } from '../components/IdeChatDock'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import {
  GripVertical,
  Globe,
  Plus,
  Trash2,
  Mic,
  X,
  FolderOpen,
  SlidersHorizontal,
  Cpu,
  Briefcase,
  Sparkles,
  RotateCcw
} from 'lucide-react'
import type { AppVersions, ConnectedProvider } from '@shared/types'
import type { UpdateInfo } from '@shared/api'
import { AUTH_LABELS } from '@shared/providers'
import { LANGUAGES, SOURCE_LANGUAGE, normalizeLanguage } from '@shared/i18n'
import { api } from '../lib/api'
import { CodeHosts } from '../components/CodeHosts'
import { Button, Input, Switch, Textarea } from '../components/ui'
import { cn } from '../lib/cn'
import {
  DEFAULT_BRANCH_PREFIX,
  branchPrefixError,
  normalizeBranchPrefix,
  placeholderBranchName
} from '@shared/branch'
import { randomSlug, slugToBranchSegment } from '@shared/slugs'
import { PageShell } from '../components/PageShell'
import { McpServers } from '../components/McpServers'
import { CookiePanel } from '../components/CookiePanel'
import { ProxyPanel } from '../components/ProxyPanel'
import { ConfigBackup } from '../components/ConfigBackup'
import { ActivitySection } from '../components/ActivitySection'
import { ProviderLogo } from '../lib/providerLogos'
import { SubscriptionAccounts } from '../components/SubscriptionSetup'
import { ModelVisibility } from '../components/ModelVisibility'
import { useRoxyStore } from '../lib/store'
import { MotionSettings } from '../components/MotionSettings'
import { recordKeybindFromEvent } from '../lib/keybind'
import { AudioRecorder } from '../lib/audio-recorder'
import { cameraManager } from '../lib/vision'

const TABS = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: SlidersHorizontal },
  { id: 'providers', labelKey: 'settings.tabs.providers', icon: Cpu },
  { id: 'voice', labelKey: 'settings.tabs.voice', icon: Mic },
  { id: 'vtuber', labelKey: 'settings.tabs.vtuber', icon: Sparkles },
  { id: 'workspace', labelKey: 'settings.tabs.workspace', icon: Briefcase }
] as const

type SettingsTab = (typeof TABS)[number]['id']

/** The section heading repeated down the page. */
const SECTION_HEADING = 'mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle'

export default function Settings(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const initialTab = (location.state as { tab?: SettingsTab } | null)?.tab ?? 'general'
  const [currentTab, setCurrentTab] = useState<SettingsTab>(initialTab)
  const providers = useRoxyStore((s) => s.providers)
  const settings = useRoxyStore((s) => s.settings)
  const refreshProviders = useRoxyStore((s) => s.refreshProviders)
  const reorderProviders = useRoxyStore((s) => s.reorderProviders)
  const setAutoWorkstream = useRoxyStore((s) => s.setAutoWorkstream)
  const setOverlayMode = useRoxyStore((s) => s.setOverlayMode)
  const setIdeMode = useRoxyStore((s) => s.setIdeMode)
  const [ideSaving, setIdeSaving] = useState(false)
  const idePending = useRef(false)
  const [ideError, setIdeError] = useState(false)
  const setOverlayKeybind = useRoxyStore((s) => s.setOverlayKeybind)
  const setVoiceKeybind = useRoxyStore((s) => s.setVoiceKeybind)
  const setVoiceAutoSend = useRoxyStore((s) => s.setVoiceAutoSend)
  const setVoiceLang = useRoxyStore((s) => s.setVoiceLang)
  const setVoiceModel = useRoxyStore((s) => s.setVoiceModel)
  const setVoiceInputDevice = useRoxyStore((s) => s.setVoiceInputDevice)
  const setVoiceWakeWord = useRoxyStore((s) => s.setVoiceWakeWord)
  const setVoiceWakeWords = useRoxyStore((s) => s.setVoiceWakeWords)
  const setTelemetryEnabled = useRoxyStore((s) => s.setTelemetryEnabled)
  const telemetryEnabled = useRoxyStore((s) => s.telemetryEnabled)
  const setBranchPrefix = useRoxyStore((s) => s.setBranchPrefix)
  const setLanguage = useRoxyStore((s) => s.setLanguage)
  const setMotion = useRoxyStore((s) => s.setMotion)
  const setTtsEnabled = useRoxyStore((s) => s.setTtsEnabled)
  const setTtsAutoStart = useRoxyStore((s) => s.setTtsAutoStart)
  const setTtsModel = useRoxyStore((s) => s.setTtsModel)
  const setTtsMode = useRoxyStore((s) => s.setTtsMode)
  const setTtsTranslate = useRoxyStore((s) => s.setTtsTranslate)
  const setTtsLang = useRoxyStore((s) => s.setTtsLang)
  const setTtsSpeed = useRoxyStore((s) => s.setTtsSpeed)
  const setTtsApiKey = useRoxyStore((s) => s.setTtsApiKey)
  const setTtsProvider = useRoxyStore((s) => s.setTtsProvider)
  const setTtsShowEmotions = useRoxyStore((s) => s.setTtsShowEmotions)
  const setFishAudioApiKey = useRoxyStore((s) => s.setFishAudioApiKey)
  const setFishAudioModel = useRoxyStore((s) => s.setFishAudioModel)
  const setFishAudioVoice = useRoxyStore((s) => s.setFishAudioVoice)
  const setFishAudioMaxWords = useRoxyStore((s) => s.setFishAudioMaxWords)
  const setVtuberEnabled = useRoxyStore((s) => s.setVtuberEnabled)
  const setVtuberModelPath = useRoxyStore((s) => s.setVtuberModelPath)
  const setVtuberVisionEnabled = useRoxyStore((s) => s.setVtuberVisionEnabled)
  const setVtuberCameraDevice = useRoxyStore((s) => s.setVtuberCameraDevice)
  const setVtuberVadEnabled = useRoxyStore((s) => s.setVtuberVadEnabled)
  const setVtuberShowChatBubble = useRoxyStore((s) => s.setVtuberShowChatBubble)
  const setVtuberShowStatus = useRoxyStore((s) => s.setVtuberShowStatus)
  const setVtuberFollowCursor = useRoxyStore((s) => s.setVtuberFollowCursor)
  const resetVtuberPosition = useRoxyStore((s) => s.resetVtuberPosition)
  const setDiscordRpcEnabled = useRoxyStore((s) => s.setDiscordRpcEnabled)
  const clearModelCache = useRoxyStore((s) => s.clearModelCache)
  const ensureModels = useRoxyStore((s) => s.ensureModels)
  const [resetPositionSuccess, setResetPositionSuccess] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [keybind, setKeybind] = useState(settings?.overlayKeybind ?? 'CommandOrControl+Shift+Space')
  const [voiceKeybind, setVoiceKeybindState] = useState(settings?.voiceKeybind ?? 'Alt+V')
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>(
    'unknown'
  )
  const [isSampling, setIsSampling] = useState(false)
  const [sampleStatus, setSampleStatus] = useState<string | null>(null)
  const [newWakeWord, setNewWakeWord] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState(settings?.ttsApiKey ?? '')
  const [fishApiKeyInput, setFishApiKeyInput] = useState(settings?.fishAudioApiKey ?? '')
  const [fishVoiceInput, setFishVoiceInput] = useState(settings?.fishAudioVoice ?? '')
  const [fishMaxWordsInput, setFishMaxWordsInput] = useState(
    String(settings?.fishAudioMaxWords ?? 0)
  )
  const [testingVoice, setTestingVoice] = useState(false)
  const [testVoiceFeedback, setTestVoiceFeedback] = useState<string | null>(null)
  const [cameraList, setCameraList] = useState<{ deviceId: string; label: string }[]>([])
  const [modelPathInput, setModelPathInput] = useState(settings?.vtuberModelPath ?? '')
  const prefixError = branchPrefixError(prefix)
  // Pinned once per mount: a preview that reshuffled on every keystroke
  // would read as noise rather than as an example.
  const [example] = useState(() => slugToBranchSegment(randomSlug()))
  const bootstrap = useRoxyStore((s) => s.bootstrap)
  const clearActive = useRoxyStore((s) => s.clearActive)
  const [versions, setVersions] = useState<AppVersions | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [dragProviderId, setDragProviderId] = useState<string | null>(null)
  const [dragOverProviderId, setDragOverProviderId] = useState<string | null>(null)
  const [dropAfterProvider, setDropAfterProvider] = useState(false)
  const [imageDiscoverySaving, setImageDiscoverySaving] = useState(false)
  const customPrompts = useRoxyStore((s) => s.customPrompts)
  const refreshCustomPrompts = useRoxyStore((s) => s.refreshCustomPrompts)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [promptName, setPromptName] = useState('')
  const [promptContent, setPromptContent] = useState('')
  const [creatingPrompt, setCreatingPrompt] = useState(false)

  const createPrompt = async (): Promise<void> => {
    if (!promptName.trim() || !promptContent.trim() || creatingPrompt) return
    setCreatingPrompt(true)
    try {
      await api.prompts.create(promptName.trim(), promptContent.trim())
      await refreshCustomPrompts()
      setPromptName('')
      setPromptContent('')
      setPromptDialogOpen(false)
    } finally {
      setCreatingPrompt(false)
    }
  }

  const reorderWithinProviders = (
    sourceId: string,
    targetId: string,
    place: 'before' | 'after'
  ): string[] | null => {
    const ids = providers.map((p) => p.id)
    const from = ids.indexOf(sourceId)
    if (from === -1 || ids.indexOf(targetId) === -1) return null
    ids.splice(from, 1)
    ids.splice(ids.indexOf(targetId) + (place === 'after' ? 1 : 0), 0, sourceId)
    if (ids.every((id, i) => id === providers[i].id)) return null
    return ids
  }

  const onProviderDrop = (targetId: string): void => {
    const source = dragProviderId
    const place = dropAfterProvider ? 'after' : 'before'
    setDragProviderId(null)
    setDragOverProviderId(null)
    setDropAfterProvider(false)
    if (!source || source === targetId) return
    const order = reorderWithinProviders(source, targetId, place)
    if (order) void reorderProviders(order)
  }

  const setImageDiscovery = async (
    provider: ConnectedProvider,
    enabled: boolean
  ): Promise<void> => {
    if (imageDiscoverySaving) return
    setImageDiscoverySaving(true)
    try {
      await api.providers.connect({
        id: provider.id,
        baseURL: provider.baseURL,
        defaultModel: provider.defaultModel,
        discoverImageModels: enabled
      })
      clearModelCache(provider.id)
      await refreshProviders()
      await ensureModels(provider.id)
    } finally {
      setImageDiscoverySaving(false)
    }
  }

  useEffect(() => {
    setPrefix(settings?.branchPrefix ?? DEFAULT_BRANCH_PREFIX)
  }, [settings?.branchPrefix])

  useEffect(() => {
    setKeybind(settings?.overlayKeybind ?? 'CommandOrControl+Shift+Space')
  }, [settings?.overlayKeybind])

  useEffect(() => {
    setVoiceKeybindState(settings?.voiceKeybind ?? 'Alt+V')
  }, [settings?.voiceKeybind])

  useEffect(() => {
    let mounted = true

    const checkPermission = async (): Promise<void> => {
      try {
        if (navigator.permissions?.query) {
          const perm = await navigator.permissions.query({
            name: 'microphone' as PermissionName
          })
          if (mounted) setMicPermission(perm.state)
          perm.onchange = () => {
            if (mounted) setMicPermission(perm.state)
          }
          return
        }
      } catch {
        // Fallback to label presence check
      }
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const hasLabels = devices.filter((d) => d.kind === 'audioinput').some((d) => d.label)
        if (mounted) setMicPermission(hasLabels ? 'granted' : 'prompt')
      }
    }

    const updateDevices = async (): Promise<void> => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return
        const devices = await navigator.mediaDevices.enumerateDevices()
        const inputs = devices.filter((d) => d.kind === 'audioinput')
        if (mounted) {
          setAudioDevices(inputs)
          if (inputs.some((d) => d.label)) {
            setMicPermission('granted')
          }
        }
      } catch (err) {
        console.warn('[Settings] Failed to enumerate audio devices:', err)
      }
    }

    void checkPermission()
    void updateDevices()
    void cameraManager.listDevices().then((devs) => mounted && setCameraList(devs))
    navigator.mediaDevices?.addEventListener('devicechange', updateDevices)
    return () => {
      mounted = false
      navigator.mediaDevices?.removeEventListener('devicechange', updateDevices)
    }
  }, [])

  const requestMicPermission = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMicPermission('granted')
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setAudioDevices(devices.filter((d) => d.kind === 'audioinput'))
      }
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicPermission('denied')
      } else {
        setMicPermission('prompt')
      }
    }
  }

  useEffect(() => {
    refreshProviders()
    api.system.getVersions().then(setVersions)
    api.updates.getState().then(setUpdate)
    const off = api.updates.onStatus((state) =>
      setUpdate((prev) => (prev ? { ...prev, state } : { version: '', packaged: true, state }))
    )
    return off
  }, [refreshProviders])

  const disconnect = async (id: string): Promise<void> => {
    await api.providers.disconnect(id)
    clearModelCache(id)
    await refreshProviders()
  }

  const resetEverything = async (): Promise<void> => {
    setResetting(true)
    await api.settings.reset()
    clearActive()
    await bootstrap()
    navigate('/onboarding')
  }

  const us = update?.state
  const updateBusy =
    us?.status === 'checking' || us?.status === 'downloading' || us?.status === 'available'
  const updateLabel = !update?.packaged
    ? t('settings.about.update.devMode')
    : us?.status === 'checking'
      ? t('settings.about.update.checking')
      : us?.status === 'available'
        ? t('settings.about.update.available', { version: us.version })
        : us?.status === 'downloading'
          ? t('settings.about.update.downloading', { percent: us.percent })
          : us?.status === 'downloaded'
            ? t('settings.about.update.downloaded', { version: us.version })
            : us?.status === 'error'
              ? t('settings.about.update.error', { message: us.message })
              : us?.status === 'not-available'
                ? t('settings.about.update.notAvailable')
                : t('settings.about.update.idle')

  const language = normalizeLanguage(settings?.language)

  const handleKeybindDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    e.stopPropagation()

    const parts: string[] = []
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    const key = e.key
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      setKeybind(parts.join('+'))
      return
    }

    let keyName = key
    if (key === ' ') keyName = 'Space'
    else if (key === '+') keyName = 'Plus'
    else if (key.length === 1) keyName = key.toUpperCase()
    else if (key === 'ArrowUp') keyName = 'Up'
    else if (key === 'ArrowDown') keyName = 'Down'
    else if (key === 'ArrowLeft') keyName = 'Left'
    else if (key === 'ArrowRight') keyName = 'Right'
    else if (key === 'Escape') keyName = 'Esc'

    parts.push(keyName)
    const finalKeybind = parts.join('+')
    setKeybind(finalKeybind)
    void setOverlayKeybind(finalKeybind)
    e.currentTarget.blur()
  }

  const handleKeybindUp = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const key = e.key
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      setKeybind(settings?.overlayKeybind ?? 'CommandOrControl+Shift+Space')
    }
  }

  const handleVoiceKeybindDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const recorded = recordKeybindFromEvent(e)
    setVoiceKeybindState(recorded.keybind)
    if (recorded.finished) {
      void setVoiceKeybind(recorded.keybind)
      e.currentTarget.blur()
    }
  }

  const handleVoiceKeybindUp = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const key = e.key
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      setVoiceKeybindState(settings?.voiceKeybind ?? 'Alt+V')
    }
  }

  const handleRecordSample = async (): Promise<void> => {
    if (isSampling) return
    setIsSampling(true)
    setSampleStatus(t('settings.voiceInput.samplingListening'))
    const recorder = new AudioRecorder()
    try {
      await recorder.start()
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const audioBuffer = await recorder.stop()
      if (!audioBuffer) {
        setSampleStatus(t('settings.voiceInput.samplingNoSpeech'))
        setIsSampling(false)
        return
      }

      setSampleStatus(t('settings.voiceInput.samplingAnalyzing'))
      const effectiveLang =
        settings?.voiceLang && settings.voiceLang !== 'auto' ? settings.voiceLang : undefined
      const res = await api.stt.transcribe(audioBuffer, {
        model: 'base',
        language: effectiveLang,
        task: 'transcribe'
      })

      const text = res?.text
        ?.trim()
        .toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\\-_`~()]/g, '')
      if (text) {
        const currentList = settings?.voiceWakeWords ?? ['hey roxy', 'roxy', 'hi roxy', 'ok roxy']
        if (!currentList.includes(text)) {
          const updated = [...currentList, text]
          await setVoiceWakeWords(updated)
        }
        setSampleStatus(t('settings.voiceInput.samplingSuccess', { text }))
      } else {
        setSampleStatus(t('settings.voiceInput.samplingNoSpeech'))
      }
    } catch (err: unknown) {
      console.error('[Settings] Sampling error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setSampleStatus(`${t('settings.voiceInput.samplingFailed')} (${msg})`)
    } finally {
      setIsSampling(false)
    }
  }

  const handleRemoveWakeWord = async (word: string): Promise<void> => {
    const currentList = settings?.voiceWakeWords ?? ['hey roxy', 'roxy', 'hi roxy', 'ok roxy']
    const updated = currentList.filter((w) => w !== word)
    await setVoiceWakeWords(updated)
  }

  const handleAddCustomWakeWord = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const clean = newWakeWord
      .trim()
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\\-_`~()]/g, '')
    if (!clean) return
    const currentList = settings?.voiceWakeWords ?? ['hey roxy', 'roxy', 'hi roxy', 'ok roxy']
    if (!currentList.includes(clean)) {
      await setVoiceWakeWords([...currentList, clean])
    }
    setNewWakeWord('')
  }

  const handleResetWakeWords = async (): Promise<void> => {
    await setVoiceWakeWords(['hey roxy', 'roxy', 'hi roxy', 'ok roxy'])
    setSampleStatus(null)
  }

  const handleResetVtuberPosition = async (): Promise<void> => {
    await resetVtuberPosition()
    setResetPositionSuccess(true)
    setTimeout(() => setResetPositionSuccess(false), 2000)
  }

  const [sttStatus, setSttStatus] = useState<{ installed: boolean; pythonPath?: string } | null>(
    null
  )
  const [installingStt, setInstallingStt] = useState(false)
  const [sttFeedback, setSttFeedback] = useState<string | null>(null)
  const [sttLogs, setSttLogs] = useState('')
  const sttConsoleEndRef = useRef<HTMLPreElement | null>(null)

  const [installedModels, setInstalledModels] = useState<string[]>([])
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const refreshInstalledModels = async (): Promise<void> => {
    try {
      const list = await api.stt.getInstalledModels()
      setInstalledModels(list)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void refreshInstalledModels()
  }, [])

  useEffect(() => {
    return api.stt.onDownloadProgress((prog) => {
      setDownloadingModel(prog.model)
      setDownloadProgress(prog.percent)
    })
  }, [])

  const handleSelectAndDownloadModel = async (modelName: string): Promise<void> => {
    await setVoiceModel(modelName)
    if (!installedModels.includes(modelName)) {
      setDownloadingModel(modelName)
      setDownloadProgress(0)
      setDownloadError(null)
      try {
        const res = await api.stt.downloadModel(modelName)
        if (res.ok) {
          setInstalledModels((prev) => Array.from(new Set([...prev, modelName])))
          setDownloadError(null)
        } else {
          setDownloadError(res.error || 'Download failed')
        }
      } catch (err: unknown) {
        setDownloadError(err instanceof Error ? err.message : String(err))
      } finally {
        setDownloadingModel(null)
        setDownloadProgress(null)
      }
    }
  }

  const refreshSttStatus = async (): Promise<void> => {
    try {
      const status = await api.stt.getStatus()
      setSttStatus(status)
    } catch {
      setSttStatus(null)
    }
  }

  useEffect(() => {
    void refreshSttStatus()
  }, [])

  useEffect(() => {
    return api.stt.onInstallProgress((chunk) => {
      setSttLogs((prev) => (prev + chunk).slice(-100_000))
    })
  }, [])

  useEffect(() => {
    if (sttConsoleEndRef.current) {
      sttConsoleEndRef.current.scrollTop = sttConsoleEndRef.current.scrollHeight
    }
  }, [sttLogs])

  const handleInstallSttDependencies = async (): Promise<void> => {
    setInstallingStt(true)
    setSttFeedback(null)
    setSttLogs('')
    try {
      const res = await api.stt.installDependencies()
      if (res.ok) {
        setSttFeedback(t('settings.voiceInput.engineInstalled'))
      } else {
        setSttFeedback(t('settings.voiceInput.engineNotInstalled'))
      }
      if (res.log && !sttLogs) {
        setSttLogs(res.log)
      }
      await refreshSttStatus()
    } catch (err: unknown) {
      setSttFeedback(String(err))
    } finally {
      setInstallingStt(false)
    }
  }

  const [ttsStatus, setTtsStatus] = useState<{ installed: boolean; running: boolean } | null>(null)
  const [installingTts, setInstallingTts] = useState(false)
  const [startingServer, setStartingServer] = useState(false)
  const [setupFeedback, setSetupFeedback] = useState<string | null>(null)
  const [serverFeedback, setServerFeedback] = useState<string | null>(null)
  const [installLogs, setInstallLogs] = useState('')
  const [serverLogs, setServerLogs] = useState('')
  const [availableTtsModels, setAvailableTtsModels] = useState<string[]>([])
  const consoleEndRef = useRef<HTMLPreElement | null>(null)
  const serverConsoleEndRef = useRef<HTMLPreElement | null>(null)

  const refreshTtsModels = async (): Promise<void> => {
    try {
      const res = await api.tts.getModels()
      if (res && Array.isArray(res.models) && res.models.length > 0) {
        setAvailableTtsModels(res.models)
      }
    } catch {
      // ignore
    }
  }

  const refreshTtsStatus = async (): Promise<void> => {
    try {
      const status = await api.tts.getStatus()
      setTtsStatus(status)
    } catch {
      setTtsStatus(null)
    }
  }

  useEffect(() => {
    void refreshTtsStatus()
    void refreshTtsModels()
    const onFocus = (): void => {
      void refreshTtsModels()
    }
    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => {
      void refreshTtsStatus()
      void refreshTtsModels()
    }, 4000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    return api.tts.onInstallProgress((chunk) => {
      setInstallLogs((prev) => prev + chunk)
    })
  }, [])

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollTop = consoleEndRef.current.scrollHeight
    }
  }, [installLogs])

  useEffect(() => {
    void api.tts.getServerLogs().then((logs) => {
      if (logs) setServerLogs(logs)
    })
    return api.tts.onServerLog((chunk) => {
      setServerLogs((prev) => prev + chunk)
    })
  }, [])

  useEffect(() => {
    if (serverConsoleEndRef.current) {
      serverConsoleEndRef.current.scrollTop = serverConsoleEndRef.current.scrollHeight
    }
  }, [serverLogs])

  const handleInstallDependencies = async (): Promise<void> => {
    setInstallingTts(true)
    setSetupFeedback(null)
    setInstallLogs('')
    try {
      const res = await api.tts.install()
      if (res.ok) {
        setSetupFeedback(t('settings.tts.setupSuccess'))
      } else {
        setSetupFeedback(t('settings.tts.setupFailed'))
      }
      if (res.log && !installLogs) {
        setInstallLogs(res.log)
      }
      await refreshTtsStatus()
    } catch {
      setSetupFeedback(t('settings.tts.setupFailed'))
    } finally {
      setInstallingTts(false)
    }
  }

  const handleToggleServer = async (): Promise<void> => {
    setServerFeedback(null)
    if (ttsStatus?.running) {
      await api.tts.stopServer()
    } else {
      setStartingServer(true)
      try {
        const res = await api.tts.startServer()
        if (!res.ok && res.error) {
          setServerFeedback(res.error)
        }
      } catch (e) {
        setServerFeedback(e instanceof Error ? e.message : String(e))
      } finally {
        setStartingServer(false)
      }
    }
    await refreshTtsStatus()
  }

  useEffect(() => {
    setApiKeyInput(settings?.ttsApiKey ?? '')
  }, [settings?.ttsApiKey])

  useEffect(() => {
    setFishApiKeyInput(settings?.fishAudioApiKey ?? '')
  }, [settings?.fishAudioApiKey])

  useEffect(() => {
    setFishVoiceInput(settings?.fishAudioVoice ?? '')
  }, [settings?.fishAudioVoice])

  useEffect(() => {
    setFishMaxWordsInput(String(settings?.fishAudioMaxWords ?? 0))
  }, [settings?.fishAudioMaxWords])

  const handleTestVoice = async (): Promise<void> => {
    setTestingVoice(true)
    setTestVoiceFeedback(null)
    try {
      const res = await api.tts.testVoice()
      if (res.ok) {
        setTestVoiceFeedback(t('settings.tts.testVoiceSuccess'))
      } else {
        setTestVoiceFeedback(
          res.error
            ? `${t('settings.tts.testVoiceFailed')}: ${res.error}`
            : t('settings.tts.testVoiceFailed')
        )
      }
    } catch (err) {
      setTestVoiceFeedback(err instanceof Error ? err.message : t('settings.tts.testVoiceFailed'))
    } finally {
      setTestingVoice(false)
    }
  }

  const ttsEnabled = settings?.ttsEnabled ?? false
  const ttsAutoStart = settings?.ttsAutoStart ?? false
  const ttsModel = settings?.ttsModel ?? 'roxy_e660_s4620.pth'
  const ttsMode = settings?.ttsMode ?? 'all'
  const ttsTranslate = settings?.ttsTranslate ?? true
  const ttsLang = settings?.ttsLang ?? 'ja'
  const ttsSpeed = settings?.ttsSpeed ?? 15
  const ttsProvider = settings?.ttsProvider ?? 'local'
  const ttsShowEmotions = settings?.ttsShowEmotions ?? false
  const fishAudioModel = settings?.fishAudioModel ?? 's2.1-pro'

  const renderGeneral = (): JSX.Element => (
    <>
      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.language.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <label htmlFor="language" className="text-sm font-medium text-text">
              {t('settings.language.label')}
            </label>
            <p className="mt-0.5 text-xs text-text-muted">{t('settings.language.description')}</p>
            {language !== SOURCE_LANGUAGE && (
              <p className="mt-2 text-xs text-text-subtle">{t('settings.language.translatedBy')}</p>
            )}
          </div>
          <select
            id="language"
            value={language}
            onChange={(e) => void setLanguage(normalizeLanguage(e.target.value))}
            className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </select>
        </div>
      </section>

      <MotionSettings onChange={setMotion} />
      <ActivitySection />

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('ide.settingsTitle')}</h2>
        <IdeChatDock />
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('ide.settingsTitle')}</div>
            <p className="mt-0.5 text-xs text-text-muted">{t('ide.settingsDescription')}</p>
            {ideSaving && (
              <p role="status" className="mt-2 text-xs text-text-muted">
                {t('ide.saving')}
              </p>
            )}
            {ideError && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {t('ide.saveError')}
              </p>
            )}
          </div>
          <Switch
            aria-label={t('ide.settingsTitle')}
            checked={settings?.ideMode ?? false}
            disabled={!settings || ideSaving}
            onChange={async (enabled) => {
              if (idePending.current) return
              idePending.current = true
              setIdeSaving(true)
              setIdeError(false)
              try {
                await setIdeMode(enabled)
              } catch {
                setIdeError(true)
              } finally {
                idePending.current = false
                setIdeSaving(false)
              }
            }}
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.privacy.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('settings.privacy.title')}</div>
            <p className="mt-0.5 text-xs text-text-muted">{t('settings.privacy.description')}</p>
            <p className="mt-2 text-xs text-text-muted">
              <Trans i18nKey="settings.privacy.labels" />
            </p>
          </div>
          <Switch checked={telemetryEnabled} onChange={(v) => void setTelemetryEnabled(v)} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.discord.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('settings.discord.title')}</div>
            <p className="mt-0.5 text-xs text-text-muted">{t('settings.discord.description')}</p>
          </div>
          <Switch
            checked={settings?.discordRpcEnabled ?? true}
            onChange={(v) => void setDiscordRpcEnabled(v)}
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.about.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">
                {t('settings.about.version', { version: versions?.app ?? t('common.dash') })}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">{updateLabel}</p>
            </div>
            {update?.state.status === 'downloaded' ? (
              <Button variant="primary" className="shrink-0" onClick={() => api.updates.install()}>
                {t('settings.about.restartToUpdate')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={!update?.packaged || updateBusy}
                onClick={() => void api.updates.check()}
                title={update?.packaged ? undefined : t('settings.about.installedAppOnly')}
              >
                {updateBusy ? t('settings.about.checking') : t('settings.about.checkForUpdates')}
              </Button>
            )}
          </div>
          {versions && (
            <p className="text-[11px] text-text-subtle">
              {t('settings.about.runtime', {
                electron: versions.electron,
                chrome: versions.chrome,
                node: versions.node
              })}
            </p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-danger">
          {t('settings.danger.heading')}
        </h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring sq-ring-danger rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('settings.danger.resetTitle')}</div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('settings.danger.resetDescription')}
            </p>
          </div>
          {confirmingReset ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmingReset(false)}
                disabled={resetting}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={resetEverything} disabled={resetting}>
                {resetting ? t('settings.danger.wiping') : t('settings.danger.confirm')}
              </Button>
            </div>
          ) : (
            <Button variant="danger" className="shrink-0" onClick={() => setConfirmingReset(true)}>
              <Trash2 className="h-3.5 w-3.5" /> {t('settings.danger.reset')}
            </Button>
          )}
        </div>
      </section>
    </>
  )

  const renderProviders = (): JSX.Element => (
    <>
      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.providers.heading')}</h2>
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <div
              key={p.id}
              draggable={providers.length > 1}
              onDragStart={(e) => {
                setDragProviderId(p.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', p.id)
              }}
              onDragEnter={() =>
                dragProviderId && dragProviderId !== p.id && setDragOverProviderId(p.id)
              }
              onDragOver={(e) => {
                if (!dragProviderId) return
                e.preventDefault()
                if (dragProviderId === p.id) return
                const rect = e.currentTarget.getBoundingClientRect()
                const after = e.clientY - rect.top > rect.height / 2
                if (dragOverProviderId !== p.id) setDragOverProviderId(p.id)
                if (after !== dropAfterProvider) setDropAfterProvider(after)
              }}
              onDrop={(e) => {
                e.preventDefault()
                onProviderDrop(p.id)
              }}
              onDragEnd={() => {
                setDragProviderId(null)
                setDragOverProviderId(null)
                setDropAfterProvider(false)
              }}
              className={cn(
                'relative',
                dragProviderId === p.id && 'opacity-40',
                dragOverProviderId === p.id &&
                  dragProviderId !== p.id &&
                  (dropAfterProvider
                    ? 'after:absolute after:inset-x-2 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-accent'
                    : 'before:absolute before:inset-x-2 before:-top-1 before:h-0.5 before:rounded-full before:bg-accent')
              )}
            >
              <ProviderRow
                provider={p}
                active={settings?.activeProviderId === p.id}
                draggable={providers.length > 1}
                dragging={dragProviderId === p.id}
                onDisconnect={() => disconnect(p.id)}
                imageDiscoverySaving={imageDiscoverySaving}
                onImageDiscoveryChange={(enabled) => void setImageDiscovery(p, enabled)}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => navigate('/onboarding')}
            className="press-scale flex items-center justify-center gap-2 sq sq-xl sq-ring sq-dashed rounded-xl border border-dashed border-border bg-surface/40 p-3.5 text-sm text-text-muted hover:border-border-strong hover:[--sq-ring:var(--color-border-strong)] hover:bg-surface hover:text-text"
          >
            <Plus className="h-4 w-4" /> {t('settings.providers.add')}
          </button>
        </div>
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.models.heading')}</h2>
        <ModelVisibility />
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.codeHosts.heading')}</h2>
        <CodeHosts />
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.customPrompts.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('settings.customPrompts.title')}</div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('settings.customPrompts.description')}
            </p>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {customPrompts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{p.name}</div>
                  <div className="truncate text-xs text-text-muted">{p.content}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm('Delete this prompt?')) {
                      void api.prompts.remove(p.id)
                      void refreshCustomPrompts()
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => setPromptDialogOpen(true)}
            >
              <Plus className="h-4 w-4" /> {t('settings.customPrompts.add')}
            </Button>
          </div>
        </div>
      </section>
    </>
  )

  const renderWorkspace = (): JSX.Element => (
    <>
      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.workstreams.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">
              {t('settings.workstreams.autoTitle')}
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('settings.workstreams.autoDescription')}
            </p>
          </div>
          <Switch
            checked={settings?.autoWorkstream ?? true}
            onChange={(v) => void setAutoWorkstream(v)}
          />
        </div>

        <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
          <div className="text-sm font-medium text-text">
            {t('settings.workstreams.prefixTitle')}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            <Trans i18nKey="settings.workstreams.prefixDescription" />
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !prefixError) void setBranchPrefix(prefix)
              }}
              spellCheck={false}
              placeholder={t('settings.workstreams.prefixPlaceholder')}
              aria-label={t('settings.workstreams.prefixAriaLabel')}
              className={cn(
                'w-48 sq sq-lg sq-ring rounded-lg border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle',
                prefixError
                  ? 'border-danger [--sq-ring:var(--color-danger)]'
                  : 'border-border focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)]'
              )}
            />
            <span className="min-w-0 truncate font-mono text-xs text-text-subtle">
              {placeholderBranchName(prefix, example)}
            </span>
            <Button
              onClick={() => void setBranchPrefix(prefix)}
              disabled={
                !!prefixError ||
                normalizeBranchPrefix(prefix) === (settings?.branchPrefix ?? DEFAULT_BRANCH_PREFIX)
              }
            >
              {t('common.save')}
            </Button>
          </div>
          {prefixError && <p className="mt-2 text-xs text-danger">{prefixError}</p>}
          <p className="mt-2 text-xs text-text-subtle">
            {t('settings.workstreams.prefixFootnote')}
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.overlay.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('settings.overlay.modeTitle')}</div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('settings.overlay.modeDescription')}
            </p>
          </div>
          <Switch
            checked={settings?.overlayMode ?? false}
            onChange={(v) => void setOverlayMode(v)}
          />
        </div>

        <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
          <div className="text-sm font-medium text-text">{t('settings.overlay.keybindTitle')}</div>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('settings.overlay.keybindDescription')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={keybind}
              onKeyDown={handleKeybindDown}
              onKeyUp={handleKeybindUp}
              onBlur={() => setKeybind(settings?.overlayKeybind ?? 'CommandOrControl+Shift+Space')}
              readOnly
              spellCheck={false}
              placeholder="Click to record keybind"
              className="w-64 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)] cursor-pointer"
            />
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.browser.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('settings.browser.title')}</div>
            <p className="mt-0.5 text-xs text-text-muted">{t('settings.browser.description')}</p>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={() => api.browser.open()}>
            <Globe className="h-3.5 w-3.5" /> {t('settings.browser.open')}
          </Button>
        </div>

        <div className="mt-3 overflow-hidden sq sq-xl sq-ring rounded-xl border border-border bg-surface">
          <div className="border-b border-border p-4">
            <div className="text-sm font-medium text-text">
              {t('settings.browser.cookiesTitle')}
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('settings.browser.cookiesDescription')}
            </p>
          </div>
          <CookiePanel className="max-h-[420px]" />
        </div>

        <div className="mt-3 overflow-hidden sq sq-xl sq-ring rounded-xl border border-border bg-surface">
          <ProxyPanel />
        </div>
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.codeHosts.heading')}</h2>
        <CodeHosts />
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.mcp.heading')}</h2>
        <McpServers />
      </section>

      <section className="mb-8">
        <h2 className={SECTION_HEADING}>{t('settings.backup.heading')}</h2>
        <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">{t('settings.backup.title')}</div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('settings.backup.description')}{' '}
              <span className="text-text-subtle">{t('settings.backup.warning')}</span>
            </p>
          </div>
          <ConfigBackup onImported={() => void bootstrap()} />
        </div>
      </section>
    </>
  )

  return (
    <PageShell title={t('settings.title')} onBack={() => navigate('/')}>
      <div className="mb-6 flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = currentTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCurrentTab(tab.id)}
              className={cn(
                'press-scale flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border border-border bg-surface-2 text-text shadow-sm'
                  : 'text-text-muted hover:bg-surface hover:text-text'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t(tab.labelKey)}</span>
            </button>
          )
        })}
      </div>

      {currentTab === 'general' && renderGeneral()}
      {currentTab === 'providers' && renderProviders()}
      {currentTab === 'workspace' && renderWorkspace()}

      {currentTab === 'voice' && (
        <>
          <section className="mb-8">
            <h2 className={SECTION_HEADING}>{t('settings.voiceInput.heading')}</h2>
            <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">
                    {t('settings.voiceInput.deviceTitle')}
                  </span>
                  {micPermission === 'granted' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {t('settings.voiceInput.permissionGranted')}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('settings.voiceInput.deviceDescription')}
                </p>
                {micPermission === 'prompt' && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => void requestMicPermission()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-3 transition-colors"
                    >
                      <Mic className="h-3 w-3" />
                      {t('settings.voiceInput.permissionPrompt')}
                    </button>
                  </div>
                )}
                {micPermission === 'denied' && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    <span>{t('settings.voiceInput.permissionDenied')}</span>
                    <button
                      type="button"
                      onClick={() => void api.system.openMicrophoneSettings()}
                      className="underline font-medium text-accent hover:text-accent-hover"
                    >
                      {t('settings.voiceInput.openSettings')}
                    </button>
                  </div>
                )}
              </div>
              <select
                value={settings?.voiceInputDevice ?? 'default'}
                onChange={(e) => void setVoiceInputDevice(e.target.value)}
                className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70 max-w-[260px] truncate"
              >
                <option value="default">{t('settings.voiceInput.deviceDefault')}</option>
                {audioDevices.map((d, index) => (
                  <option key={d.deviceId || index} value={d.deviceId}>
                    {d.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">
                      {t('settings.voiceInput.engineTitle')}
                    </span>
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        sttStatus?.installed
                          ? 'bg-success shadow-[0_0_8px_var(--color-success)]'
                          : 'bg-amber-400'
                      )}
                    />
                    <span className="text-xs font-medium text-text-subtle">
                      {sttStatus?.installed
                        ? t('settings.voiceInput.engineInstalled')
                        : t('settings.voiceInput.engineNotInstalled')}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.voiceInput.engineDescription')}
                  </p>
                  {sttFeedback && (
                    <p className="mt-2 text-xs font-medium text-accent">{sttFeedback}</p>
                  )}
                </div>
                <Button
                  variant={sttStatus?.installed ? 'ghost' : 'secondary'}
                  onClick={() => void handleInstallSttDependencies()}
                  disabled={installingStt}
                  className="shrink-0"
                >
                  {installingStt
                    ? t('settings.voiceInput.installingEngine')
                    : sttStatus?.installed
                      ? t('settings.voiceInput.reinstallEngine')
                      : t('settings.voiceInput.installEngine')}
                </Button>
              </div>

              {(installingStt || sttLogs) && (
                <div className="mt-3 overflow-hidden rounded-lg border border-border bg-black/90">
                  <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 font-mono text-xs text-text-subtle">
                    <span>{t('settings.tts.consoleTitle')}</span>
                    {sttLogs && !installingStt && (
                      <button
                        type="button"
                        onClick={() => setSttLogs('')}
                        className="text-xs text-text-subtle hover:text-text transition-colors"
                      >
                        {t('settings.tts.clearConsole')}
                      </button>
                    )}
                  </div>
                  <pre
                    ref={sttConsoleEndRef}
                    className="max-h-60 overflow-y-auto p-3 font-mono text-xs leading-relaxed text-text whitespace-pre-wrap select-text"
                  >
                    {sttLogs || t('settings.voiceInput.installingEngine')}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text">
                  {t('settings.voiceInput.wakeWordTitle')}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('settings.voiceInput.wakeWordDescription')}
                </p>
              </div>
              <Switch
                checked={settings?.voiceWakeWord ?? false}
                onChange={(v) => void setVoiceWakeWord(v)}
              />
            </div>

            {settings?.voiceWakeWord && (
              <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {t('settings.voiceInput.samplingTitle')}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('settings.voiceInput.samplingDescription')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isSampling}
                    onClick={() => void handleRecordSample()}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      isSampling
                        ? 'animate-pulse bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-surface-2 hover:bg-surface-3 text-text border border-border'
                    }`}
                  >
                    {isSampling ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-red-400 animate-ping" />
                        {t('settings.voiceInput.samplingListening')}
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5" />
                        {t('settings.voiceInput.samplingButton')}
                      </>
                    )}
                  </button>
                </div>

                {sampleStatus && (
                  <div className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5 text-xs text-text">
                    {sampleStatus}
                  </div>
                )}

                <div className="mt-4 border-t border-border pt-3">
                  <div className="text-xs font-medium text-text-muted">
                    {t('settings.voiceInput.phrasesTitle')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(settings?.voiceWakeWords ?? ['hey roxy', 'roxy', 'hi roxy', 'ok roxy']).map(
                      (word) => (
                        <span
                          key={word}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-text"
                        >
                          <span>{word}</span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveWakeWord(word)}
                            className="text-text-muted hover:text-text"
                            title={t('settings.voiceInput.removePhrase')}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )
                    )}
                  </div>

                  <form onSubmit={handleAddCustomWakeWord} className="mt-3 flex items-center gap-2">
                    <input
                      value={newWakeWord}
                      onChange={(e) => setNewWakeWord(e.target.value)}
                      placeholder={t('settings.voiceInput.addPhrasePlaceholder')}
                      className="flex-1 max-w-xs sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1 text-xs text-text outline-none placeholder:text-text-subtle focus:border-border-strong"
                    />
                    <button
                      type="submit"
                      disabled={!newWakeWord.trim()}
                      className="rounded-lg border border-border bg-surface-2 px-3 py-1 text-xs font-medium text-text hover:bg-surface-3 disabled:opacity-50"
                    >
                      {t('settings.voiceInput.addPhraseButton')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResetWakeWords()}
                      className="ml-auto text-xs text-text-muted hover:text-text underline decoration-dotted"
                    >
                      {t('settings.voiceInput.resetPhrases')}
                    </button>
                  </form>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text">
                  {t('settings.voiceInput.autoSendTitle')}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('settings.voiceInput.autoSendDescription')}
                </p>
              </div>
              <Switch
                checked={settings?.voiceAutoSend ?? false}
                onChange={(v) => void setVoiceAutoSend(v)}
              />
            </div>

            <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text">
                  {t('settings.voiceInput.langTitle')}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('settings.voiceInput.langDescription')}
                </p>
              </div>
              <select
                value={settings?.voiceLang ?? 'auto'}
                onChange={(e) => void setVoiceLang(e.target.value)}
                className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
              >
                <option value="auto">{t('settings.voiceInput.langAuto')}</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName} ({l.name})
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">
                      {t('settings.voiceInput.modelTitle')}
                    </span>
                    {installedModels.includes(settings?.voiceModel ?? 'base') && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {t('settings.voiceInput.modelInstalled')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.voiceInput.modelDescription')}
                  </p>
                </div>
                <select
                  value={settings?.voiceModel ?? 'base'}
                  disabled={downloadingModel !== null}
                  onChange={(e) => void handleSelectAndDownloadModel(e.target.value)}
                  className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
                >
                  <option value="tiny">
                    {t('settings.voiceInput.modelTiny')}{' '}
                    {installedModels.includes('tiny')
                      ? `(${t('settings.voiceInput.modelInstalled')})`
                      : ''}
                  </option>
                  <option value="base">
                    {t('settings.voiceInput.modelBase')}{' '}
                    {installedModels.includes('base')
                      ? `(${t('settings.voiceInput.modelInstalled')})`
                      : ''}
                  </option>
                  <option value="small">
                    {t('settings.voiceInput.modelSmall')}{' '}
                    {installedModels.includes('small')
                      ? `(${t('settings.voiceInput.modelInstalled')})`
                      : ''}
                  </option>
                  <option value="medium">
                    {t('settings.voiceInput.modelMedium')}{' '}
                    {installedModels.includes('medium')
                      ? `(${t('settings.voiceInput.modelInstalled')})`
                      : ''}
                  </option>
                  <option value="distil-large-v3">
                    {t('settings.voiceInput.modelDistilLarge')}{' '}
                    {installedModels.includes('distil-large-v3')
                      ? `(${t('settings.voiceInput.modelInstalled')})`
                      : ''}
                  </option>
                  <option value="large-v3">
                    {t('settings.voiceInput.modelLarge')}{' '}
                    {installedModels.includes('large-v3')
                      ? `(${t('settings.voiceInput.modelInstalled')})`
                      : ''}
                  </option>
                </select>
              </div>

              {downloadingModel && (
                <div className="mt-3 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
                  <div className="flex items-center justify-between text-xs text-text">
                    <span className="font-medium flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-accent animate-ping" />
                      {t('settings.voiceInput.modelDownloading', { model: downloadingModel })}
                    </span>
                    <span className="font-mono text-text-muted">
                      {downloadProgress !== null ? `${Math.round(downloadProgress)}%` : '0%'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3 border border-border/50">
                    <div
                      className="h-full bg-accent transition-all duration-200"
                      style={{ width: `${Math.max(4, downloadProgress ?? 0)}%` }}
                    />
                  </div>
                </div>
              )}

              {!downloadingModel && downloadError && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
                  <span>{downloadError}</span>
                  <button
                    type="button"
                    onClick={() =>
                      void handleSelectAndDownloadModel(settings?.voiceModel ?? 'base')
                    }
                    className="ml-2 underline font-medium text-text hover:text-text-muted"
                  >
                    {t('settings.voiceInput.downloadModelButton')}
                  </button>
                </div>
              )}

              {!downloadingModel &&
                !downloadError &&
                !installedModels.includes(settings?.voiceModel ?? 'base') && (
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface-2 p-2.5 text-xs text-text">
                    <span className="text-text-muted">
                      {settings?.voiceModel ?? 'base'} is not yet downloaded.
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void handleSelectAndDownloadModel(settings?.voiceModel ?? 'base')
                      }
                    >
                      {t('settings.voiceInput.downloadModelButton')}
                    </Button>
                  </div>
                )}
            </div>

            <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
              <div className="text-sm font-medium text-text">
                {t('settings.voiceInput.keybindTitle')}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {t('settings.voiceInput.keybindDescription')}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  value={voiceKeybind}
                  onFocus={() => void api.stt.setShortcutPaused(true)}
                  onKeyDown={handleVoiceKeybindDown}
                  onKeyUp={handleVoiceKeybindUp}
                  onBlur={() => {
                    void api.stt.setShortcutPaused(false)
                    setVoiceKeybindState(settings?.voiceKeybind ?? 'Alt+V')
                  }}
                  readOnly
                  spellCheck={false}
                  placeholder={t('settings.voiceInput.recordPlaceholder')}
                  className="w-64 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)] cursor-pointer"
                />
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className={SECTION_HEADING}>{t('settings.tts.heading')}</h2>
            <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text">{t('settings.tts.enableTitle')}</div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('settings.tts.enableDescription')}
                </p>
              </div>
              <Switch checked={ttsEnabled} onChange={(v) => void setTtsEnabled(v)} />
            </div>

            {ttsEnabled && (
              <>
                <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {t('settings.tts.providerTitle')}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('settings.tts.providerDescription')}
                    </p>
                  </div>
                  <select
                    value={ttsProvider}
                    onChange={(e) => void setTtsProvider(e.target.value as 'local' | 'fish')}
                    className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
                  >
                    <option value="local">{t('settings.tts.providerLocal')}</option>
                    <option value="fish">{t('settings.tts.providerFish')}</option>
                  </select>
                </div>

                {ttsProvider === 'fish' ? (
                  <>
                    <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                      <div className="text-sm font-medium text-text">
                        {t('settings.tts.fishApiKeyTitle')}
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t('settings.tts.fishApiKeyDescription')}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="password"
                          value={fishApiKeyInput}
                          onChange={(e) => setFishApiKeyInput(e.target.value)}
                          placeholder={t('settings.tts.fishApiKeyPlaceholder')}
                          className="w-80 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)]"
                        />
                        <Button
                          onClick={() => void setFishAudioApiKey(fishApiKeyInput)}
                          disabled={fishApiKeyInput === (settings?.fishAudioApiKey ?? '')}
                        >
                          {t('settings.tts.saveFishApiKey')}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text">
                          {t('settings.tts.fishModelTitle')}
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {t('settings.tts.fishModelDescription')}
                        </p>
                      </div>
                      <select
                        value={fishAudioModel}
                        onChange={(e) => void setFishAudioModel(e.target.value)}
                        className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
                      >
                        <option value="s2.1-pro">s2.1-pro</option>
                        <option value="s2.1-pro-free">s2.1-pro-free</option>
                        <option value="s2-pro">s2-pro</option>
                        <option value="drama-3-preview">drama-3-preview</option>
                        <option value="s1">s1</option>
                      </select>
                    </div>

                    <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                      <div className="text-sm font-medium text-text">
                        {t('settings.tts.fishVoiceTitle')}
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t('settings.tts.fishVoiceDescription')}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="text"
                          value={fishVoiceInput}
                          onChange={(e) => setFishVoiceInput(e.target.value)}
                          placeholder={t('settings.tts.fishVoicePlaceholder')}
                          className="w-80 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)] font-mono text-xs"
                        />
                        <Button
                          onClick={() => void setFishAudioVoice(fishVoiceInput)}
                          disabled={fishVoiceInput === (settings?.fishAudioVoice ?? '')}
                        >
                          {t('settings.tts.saveFishVoice')}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                      <div className="text-sm font-medium text-text">
                        {t('settings.tts.fishMaxWordsTitle')}
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t('settings.tts.fishMaxWordsDescription')}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={fishMaxWordsInput}
                          onChange={(e) => setFishMaxWordsInput(e.target.value)}
                          placeholder="0"
                          className="w-32 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)]"
                        />
                        <Button
                          onClick={() =>
                            void setFishAudioMaxWords(
                              Math.max(0, parseInt(fishMaxWordsInput, 10) || 0)
                            )
                          }
                          disabled={
                            (parseInt(fishMaxWordsInput, 10) || 0) ===
                            (settings?.fishAudioMaxWords ?? 0)
                          }
                        >
                          {t('common.save')}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text">
                          {t('settings.tts.testVoiceButton')}
                        </div>
                        {testVoiceFeedback && (
                          <p className="mt-1 text-xs font-medium text-accent">
                            {testVoiceFeedback}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => void handleTestVoice()}
                        disabled={testingVoice || !settings?.fishAudioApiKey}
                        className="shrink-0"
                      >
                        {testingVoice
                          ? t('settings.tts.testingVoice')
                          : t('settings.tts.testVoiceButton')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text">
                            {t('settings.tts.serverTitle')}
                          </div>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {t('settings.tts.serverDescription')}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <span
                              className={cn(
                                'inline-block h-2 w-2 rounded-full',
                                ttsStatus?.running
                                  ? 'bg-success shadow-[0_0_8px_var(--color-success)]'
                                  : 'bg-text-subtle'
                              )}
                            />
                            <span className="text-xs font-medium text-text-subtle">
                              {ttsStatus?.running
                                ? t('settings.tts.serverRunning')
                                : t('settings.tts.serverStopped')}
                            </span>
                          </div>
                          {serverFeedback && (
                            <p className="mt-2 text-xs font-medium text-accent">{serverFeedback}</p>
                          )}
                        </div>
                        <Button
                          variant={ttsStatus?.running ? 'ghost' : 'primary'}
                          onClick={() => void handleToggleServer()}
                          disabled={startingServer}
                          className="shrink-0"
                        >
                          {startingServer
                            ? t('settings.tts.startingServer')
                            : ttsStatus?.running
                              ? t('settings.tts.stopServer')
                              : t('settings.tts.startServer')}
                        </Button>
                      </div>

                      {(startingServer || serverLogs) && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-black/90">
                          <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 font-mono text-xs text-text-subtle">
                            <span>{t('settings.tts.serverConsoleTitle')}</span>
                            {serverLogs && !startingServer && (
                              <button
                                type="button"
                                onClick={() => {
                                  setServerLogs('')
                                  void api.tts.clearServerLogs()
                                }}
                                className="text-xs text-text-subtle hover:text-text transition-colors"
                              >
                                {t('settings.tts.clearConsole')}
                              </button>
                            )}
                          </div>
                          <pre
                            ref={serverConsoleEndRef}
                            className="max-h-60 overflow-y-auto p-3 font-mono text-xs leading-relaxed text-text whitespace-pre-wrap select-text"
                          >
                            {serverLogs || t('settings.tts.startingServer')}
                          </pre>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text">
                          {t('settings.tts.autoStartTitle')}
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {t('settings.tts.autoStartDescription')}
                        </p>
                      </div>
                      <Switch
                        checked={ttsAutoStart}
                        onChange={(v) => {
                          void setTtsAutoStart(v)
                          if (v && !ttsStatus?.running) {
                            void handleToggleServer()
                          }
                        }}
                      />
                    </div>

                    <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text">
                            {t('settings.tts.setupTitle')}
                          </div>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {t('settings.tts.setupDescription')}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <span
                              className={cn(
                                'inline-block h-2 w-2 rounded-full',
                                ttsStatus?.installed
                                  ? 'bg-success shadow-[0_0_8px_var(--color-success)]'
                                  : 'bg-text-subtle'
                              )}
                            />
                            <span className="text-xs font-medium text-text-subtle">
                              {ttsStatus?.installed
                                ? t('settings.tts.requirementsMet')
                                : t('settings.tts.requirementsNotMet')}
                            </span>
                          </div>
                          {setupFeedback && (
                            <p className="mt-2 text-xs font-medium text-accent">{setupFeedback}</p>
                          )}
                        </div>
                        <Button
                          variant={ttsStatus?.installed ? 'ghost' : 'secondary'}
                          onClick={() => void handleInstallDependencies()}
                          disabled={installingTts}
                          className="shrink-0"
                        >
                          {installingTts
                            ? t('settings.tts.setupInstalling')
                            : ttsStatus?.installed
                              ? t('settings.tts.reinstallButton')
                              : t('settings.tts.setupButton')}
                        </Button>
                      </div>

                      {(installingTts || installLogs) && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-black/90">
                          <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 font-mono text-xs text-text-subtle">
                            <span>{t('settings.tts.consoleTitle')}</span>
                            {installLogs && !installingTts && (
                              <button
                                type="button"
                                onClick={() => setInstallLogs('')}
                                className="text-xs text-text-subtle hover:text-text transition-colors"
                              >
                                {t('settings.tts.clearConsole')}
                              </button>
                            )}
                          </div>
                          <pre
                            ref={consoleEndRef}
                            className="max-h-60 overflow-y-auto p-3 font-mono text-xs leading-relaxed text-text whitespace-pre-wrap select-text"
                          >
                            {installLogs || t('settings.tts.setupInstalling')}
                          </pre>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-text">
                            {t('settings.tts.modelTitle')}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              void api.tts.openModelsFolder()
                              void refreshTtsModels()
                            }}
                            className="h-6 gap-1 px-2 text-xs text-text-muted hover:text-text"
                            title={t('settings.tts.openModelsFolder')}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                            <span>{t('settings.tts.openFolder')}</span>
                          </Button>
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {t('settings.tts.modelDescription')}
                        </p>
                      </div>
                      <select
                        value={ttsModel}
                        onChange={(e) => void setTtsModel(e.target.value)}
                        className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
                      >
                        {Array.from(new Set([ttsModel, ...availableTtsModels])).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {t('settings.tts.translateTitle')}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('settings.tts.translateDescription')}
                    </p>
                  </div>
                  <Switch checked={ttsTranslate} onChange={(v) => void setTtsTranslate(v)} />
                </div>

                {ttsTranslate && (
                  <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text">
                        {t('settings.tts.langTitle')}
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t('settings.tts.langDescription')}
                      </p>
                    </div>
                    <select
                      value={ttsLang}
                      onChange={(e) => void setTtsLang(e.target.value)}
                      className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
                    >
                      <option value="ja">{t('settings.tts.langJa')}</option>
                      <option value="none">{t('settings.tts.langNone')}</option>
                      <option value="en">{t('settings.tts.langEn')}</option>
                      <option value="zh">{t('settings.tts.langZh')}</option>
                      <option value="ko">{t('settings.tts.langKo')}</option>
                      <option value="es">{t('settings.tts.langEs')}</option>
                      <option value="fr">{t('settings.tts.langFr')}</option>
                      <option value="de">{t('settings.tts.langDe')}</option>
                    </select>
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {t('settings.tts.modeTitle')}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('settings.tts.modeDescription')}
                    </p>
                  </div>
                  <select
                    value={ttsMode}
                    onChange={(e) => void setTtsMode(e.target.value as 'all' | 'sentence')}
                    className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
                  >
                    <option value="all">{t('settings.tts.modeAll')}</option>
                    <option value="sentence">{t('settings.tts.modeSentence')}</option>
                  </select>
                </div>

                <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {t('settings.tts.showEmotionsTitle')}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('settings.tts.showEmotionsDescription')}
                    </p>
                  </div>
                  <Switch checked={ttsShowEmotions} onChange={(v) => void setTtsShowEmotions(v)} />
                </div>

                <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-text">
                        {t('settings.tts.speedTitle')}
                      </div>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-accent">
                        {ttsSpeed >= 0 ? `+${ttsSpeed}%` : `${ttsSpeed}%`}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('settings.tts.speedDescription')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <input
                      type="range"
                      min={-50}
                      max={100}
                      step={5}
                      value={ttsSpeed}
                      onChange={(e) => void setTtsSpeed(Number(e.target.value))}
                      className="h-2 w-36 cursor-pointer accent-accent"
                    />
                    {ttsSpeed !== 15 && (
                      <button
                        type="button"
                        onClick={() => void setTtsSpeed(15)}
                        className="text-xs text-text-subtle hover:text-text transition-colors whitespace-nowrap"
                      >
                        {t('settings.tts.resetSpeed')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                  <div className="text-sm font-medium text-text">
                    {t('settings.tts.apiKeyTitle')}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.tts.apiKeyDescription')}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={t('settings.tts.apiKeyPlaceholder')}
                      className="w-80 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)]"
                    />
                    <Button
                      onClick={() => void setTtsApiKey(apiKeyInput)}
                      disabled={apiKeyInput === (settings?.ttsApiKey ?? '')}
                    >
                      {t('settings.tts.saveApiKey')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {currentTab === 'vtuber' && (
        <section className="mb-8">
          <h2 className={SECTION_HEADING}>{t('settings.vtuber.heading')}</h2>
          <div className="flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">
                {t('settings.vtuber.enableTitle')}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {t('settings.vtuber.enableDescription')}
              </p>
            </div>
            <Switch
              checked={settings?.vtuberEnabled ?? false}
              onChange={(v) => void setVtuberEnabled(v)}
            />
          </div>

          {settings?.vtuberEnabled && (
            <>
              {/* Live2D Model Path */}
              <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                <div className="text-sm font-medium text-text">
                  {t('settings.vtuber.modelTitle')}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('settings.vtuber.modelDescription')}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={modelPathInput}
                    onChange={(e) => setModelPathInput(e.target.value)}
                    placeholder={t('settings.vtuber.modelPlaceholder')}
                    className="flex-1 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)]"
                  />
                  <Button
                    onClick={() => void setVtuberModelPath(modelPathInput)}
                    disabled={modelPathInput === (settings?.vtuberModelPath ?? '')}
                  >
                    {t('settings.vtuber.saveModel')}
                  </Button>
                </div>
              </div>

              {/* Follow Cursor Toggle */}
              <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">
                    {t('settings.vtuber.followCursorTitle')}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.vtuber.followCursorDescription')}
                  </p>
                </div>
                <Switch
                  checked={settings?.vtuberFollowCursor ?? true}
                  onChange={(v) => void setVtuberFollowCursor(v)}
                />
              </div>

              {/* Chat Bubbles Toggle */}
              <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">
                    {t('settings.vtuber.chatBubbleTitle')}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.vtuber.chatBubbleDescription')}
                  </p>
                </div>
                <Switch
                  checked={settings?.vtuberShowChatBubble ?? true}
                  onChange={(v) => void setVtuberShowChatBubble(v)}
                />
              </div>

              {/* Status Indicator Toggle */}
              <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">
                    {t('settings.vtuber.statusTitle')}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.vtuber.statusDescription')}
                  </p>
                </div>
                <Switch
                  checked={settings?.vtuberShowStatus ?? true}
                  onChange={(v) => void setVtuberShowStatus(v)}
                />
              </div>

              {/* Continuous Mic VAD Voice Conversation */}
              <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">
                    {t('settings.vtuber.vadTitle')}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.vtuber.vadDescription')}
                  </p>
                </div>
                <Switch
                  checked={settings?.vtuberVadEnabled ?? false}
                  onChange={(v) => void setVtuberVadEnabled(v)}
                />
              </div>

              {/* Computer Vision / Webcam */}
              <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">
                    {t('settings.vtuber.visionTitle')}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.vtuber.visionDescription')}
                  </p>
                </div>
                <Switch
                  checked={settings?.vtuberVisionEnabled ?? false}
                  onChange={(v) => void setVtuberVisionEnabled(v)}
                />
              </div>

              {/* Camera device picker */}
              {settings?.vtuberVisionEnabled && cameraList.length > 0 && (
                <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {t('settings.vtuber.cameraTitle')}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('settings.vtuber.cameraDescription')}
                    </p>
                  </div>
                  <select
                    value={settings?.vtuberCameraDevice || 'default'}
                    onChange={(e) => void setVtuberCameraDevice(e.target.value)}
                    className="h-9 min-w-48 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none focus:border-accent"
                  >
                    <option value="default">{t('settings.vtuber.defaultCamera')}</option>
                    {cameraList.map((cam) => (
                      <option key={cam.deviceId} value={cam.deviceId}>
                        {cam.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Reset Window Position */}
              <div className="mt-3 flex flex-col gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">
                    {t('settings.vtuber.resetPositionTitle')}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {t('settings.vtuber.resetPositionDescription')}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => void handleResetVtuberPosition()}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {resetPositionSuccess ? t('common.saved') : t('settings.vtuber.resetPosition')}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {promptDialogOpen && (
        <div
          className="animate-scrim-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => !creatingPrompt && setPromptDialogOpen(false)}
        >
          <form
            className="animate-modal-in w-full max-w-lg sq sq-2xl sq-ring rounded-2xl border border-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              void createPrompt()
            }}
          >
            <h2 className="text-lg font-semibold">{t('settings.customPrompts.createTitle')}</h2>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">
                  {t('settings.customPrompts.name')}
                </span>
                <Input
                  value={promptName}
                  onChange={(event) => setPromptName(event.target.value)}
                  placeholder={t('settings.customPrompts.namePlaceholder')}
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">
                  {t('settings.customPrompts.content')}
                </span>
                <Textarea
                  value={promptContent}
                  onChange={(event) => setPromptContent(event.target.value)}
                  placeholder={t('settings.customPrompts.contentPlaceholder')}
                  rows={8}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPromptDialogOpen(false)}
                disabled={creatingPrompt}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!promptName.trim() || !promptContent.trim() || creatingPrompt}
              >
                {creatingPrompt
                  ? t('settings.customPrompts.creating')
                  : t('settings.customPrompts.create')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </PageShell>
  )
}

function ProviderRow({
  provider,
  active,
  draggable,
  dragging,
  onDisconnect,
  imageDiscoverySaving,
  onImageDiscoveryChange
}: {
  provider: ConnectedProvider
  active: boolean
  draggable: boolean
  dragging: boolean
  onDisconnect: () => void
  imageDiscoverySaving: boolean
  onImageDiscoveryChange: (enabled: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex items-center gap-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-3.5 transition',
        dragging && 'cursor-grabbing',
        draggable && !dragging && 'cursor-grab'
      )}
    >
      <GripVertical
        className={cn(
          'h-4 w-4 shrink-0 text-text-subtle transition',
          draggable ? 'opacity-70' : 'opacity-20'
        )}
        aria-hidden="true"
      />
      <div className="flex h-8 w-8 items-center justify-center sq sq-lg sq-ring rounded-lg border border-border bg-surface-2">
        <ProviderLogo id={provider.id} name={provider.name} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">{provider.name}</span>
          {active && (
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">
              {t('settings.providers.active')}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-text-subtle">
          {AUTH_LABELS[provider.auth]} ·{' '}
          {provider.auth === 'subscription'
            ? t('settings.providers.signedInLocally')
            : provider.hasCredential
              ? t('settings.providers.keyStored')
              : t('settings.providers.noCredential')}
        </p>
        {/* Subscription providers hold their credential in the sidecar, not in
            Roxy - so the row lists the signed-in accounts instead of a key. The
            id is required: one sidecar holds every subscription's accounts, and
            a row must show only its own. */}
        {provider.auth === 'subscription' && <SubscriptionAccounts providerId={provider.id} />}
        {provider.id === 'openai-compatible' && (
          <div className="mt-2 flex items-center gap-2">
            <Switch
              checked={provider.discoverImageModels}
              onChange={onImageDiscoveryChange}
              disabled={imageDiscoverySaving}
            />
            <div>
              <div className="text-xs font-medium text-text">
                {t('settings.providers.discoverImageModels')}
              </div>
              <div className="text-[11px] text-text-subtle">
                {t('settings.providers.discoverImageModelsBody')}
              </div>
            </div>
          </div>
        )}
      </div>
      <Button size="sm" variant="ghost" onClick={onDisconnect}>
        {t('settings.providers.disconnect')}
      </Button>
    </div>
  )
}
