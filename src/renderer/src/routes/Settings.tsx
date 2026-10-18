import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import {
  Activity,
  ArrowUpDown,
  Bell,
  ChevronDown,
  DatabaseBackup,
  FolderOpen,
  GitBranch,
  Globe,
  Image,
  Info,
  Languages,
  Lightbulb,
  Mic,
  Volume2,
  MonitorSmartphone,
  Palette,
  Plug,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Trash2,
  UserRound
} from 'lucide-react'
import { api } from '../lib/api'
import { useRoxyStore } from '../lib/store'
import { Button, Input, Switch, Textarea } from '../components/ui'
import { ProviderAccount } from '../components/ProviderAccount'
import { ProviderSetup, AddAccount } from './onboarding/ProviderStep'
import { cn } from '../lib/cn'
import {
  DEFAULT_BRANCH_PREFIX,
  branchPrefixError,
  normalizeBranchPrefix,
  placeholderBranchName
} from '@shared/branch'
import { randomSlug, slugToBranchSegment } from '@shared/slugs'
import { PageShell } from '../components/PageShell'
import type { AppVersions } from '@shared/types'
import type { UpdateInfo } from '@shared/api'
import { resolveSeed } from '@shared/providers'
import { LANGUAGES, SOURCE_LANGUAGE, normalizeLanguage } from '@shared/i18n'
import { CodeHosts } from '../components/CodeHosts'
import { CookiePanel } from '../components/CookiePanel'
import { ProxyPanel } from '../components/ProxyPanel'
import { ConfigBackup } from '../components/ConfigBackup'
import { ActivitySection } from '../components/ActivitySection'
import { NotificationSettings } from '../components/NotificationSettings'
import { MotionSettings } from '../components/MotionSettings'
import { ProfileImageCropper } from '../components/ProfileImageCropper'
import { cameraManager } from '../lib/vision'

import { BackgroundSettings } from '../components/BackgroundSettings'
import { VoiceSettings } from '../components/VoiceSettings'
import { RemoteWorkspaceDialog } from '../components/RemoteWorkspaceDialog'
import { SidebarNavItem } from '../components/SidebarFrame'
import Themes from './Themes'
import Skills from './Skills'
import Mcp from './Mcp'

const SETTINGS_GROUPS = [
  {
    label: 'settings.navigation.theme',
    items: [
      { id: 'background', label: 'appearance.background', icon: Image },
      { id: 'colors', label: 'settings.navigation.colors', icon: Palette },
      { id: 'motion', label: 'settings.motion.label', icon: Sparkles }
    ]
  },
  {
    label: 'settings.navigation.addOns',
    items: [
      { id: 'skills', label: 'sidebar.skills', icon: Lightbulb },
      { id: 'mcp', label: 'sidebar.mcpServers', icon: Plug },
      { id: 'backup', label: 'settings.backup.heading', icon: DatabaseBackup }
    ]
  },
  {
    label: 'settings.navigation.general',
    items: [
      { id: 'profile', label: 'settings.profile.heading', icon: UserRound },
      { id: 'tts', label: 'settings.tts.heading', icon: Volume2 },
      { id: 'vtuber', label: 'settings.tabs.vtuber', icon: Sparkles },
      { id: 'overlay', label: 'settings.overlay.heading', icon: MonitorSmartphone },
      { id: 'discord', label: 'settings.discord.heading', icon: Activity },
      { id: 'accounts', label: 'settings.navigation.accounts', icon: UserRound },
      { id: 'browser', label: 'settings.browser.heading', icon: Globe },
      { id: 'language', label: 'settings.language.heading', icon: Languages },
      { id: 'voice', label: 'voice.heading', icon: Mic },
      { id: 'worktrees', label: 'settings.navigation.worktrees', icon: GitBranch },
      { id: 'notifications', label: 'settings.notifications.heading', icon: Bell },
      { id: 'remote', label: 'sidebar.remoteWorkspace', icon: MonitorSmartphone },
      { id: 'activity', label: 'settings.navigation.activity', icon: Activity },
      { id: 'privacy', label: 'settings.privacy.heading', icon: Shield },
      { id: 'about', label: 'settings.about.heading', icon: Info }
    ]
  }
] as const

type SettingsSection = (typeof SETTINGS_GROUPS)[number]['items'][number]['id']

/** The section heading repeated down the page. */
const SECTION_HEADING = 'mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle'

export default function Settings(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { section } = useParams()
  const location = useLocation()
  const legacyTab = (location.state as { tab?: string } | null)?.tab
  const legacySection =
    legacyTab === 'providers'
      ? 'accounts'
      : legacyTab === 'workspace'
        ? 'worktrees'
        : legacyTab === 'general'
          ? 'profile'
          : legacyTab
  const selected = SETTINGS_GROUPS.flatMap((group) => [...group.items]).find(
    (item) => item.id === (section ?? legacySection)
  )
  const panel: SettingsSection = selected?.id ?? 'activity'
  // Mount on first visit, then retain editors and their unsaved drafts.
  const [visited, setVisited] = useState<Set<SettingsSection>>(() => new Set([panel]))
  useEffect(() => {
    setVisited((previous) => (previous.has(panel) ? previous : new Set([...previous, panel])))
  }, [panel])
  const [remoteOpen, setRemoteOpen] = useState(false)
  const remotePhase = useRoxyStore((s) => s.remote.phase)
  const providers = useRoxyStore((s) => s.providers)
  const settings = useRoxyStore((s) => s.settings)
  const refreshProviders = useRoxyStore((s) => s.refreshProviders)
  const refreshUsage = useRoxyStore((s) => s.refreshUsage)
  // Each account card shows its token use, so fetch fresh figures on open.
  useEffect(() => {
    if (panel === 'accounts') void refreshUsage()
  }, [panel, refreshUsage])
  const reorderProviders = useRoxyStore((s) => s.reorderProviders)
  const setAutoWorkstream = useRoxyStore((s) => s.setAutoWorkstream)
  const setOverlayMode = useRoxyStore((s) => s.setOverlayMode)
  const setOverlayKeybind = useRoxyStore((s) => s.setOverlayKeybind)
  const setUserProfile = useRoxyStore((s) => s.setUserProfile)
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
  const setTtsOpenaiConfig = useRoxyStore((s) => s.setTtsOpenaiConfig)
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
  const [resetPositionSuccess, setResetPositionSuccess] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [keybind, setKeybind] = useState(settings?.overlayKeybind ?? 'CommandOrControl+Shift+Space')
  const [profileName, setProfileName] = useState(settings?.userProfileName ?? '')
  const [profileAvatar, setProfileAvatar] = useState(settings?.userProfileAvatar ?? '')
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null)
  const [profileError, setProfileError] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [ttsOpenaiUrl, setTtsOpenaiUrl] = useState('')
  const [ttsOpenaiModel, setTtsOpenaiModel] = useState('')
  const [ttsOpenaiKey, setTtsOpenaiKey] = useState('')
  const [ttsOpenaiError, setTtsOpenaiError] = useState('')
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
  useEffect(() => {
    setConfirmingReset(false)
  }, [panel])
  const [cookiesOpen, setCookiesOpen] = useState(false)
  const cookiesPanelId = useId()
  const [resetting, setResetting] = useState(false)
  const [dragProviderId, setDragProviderId] = useState<string | null>(null)
  const [dragOverProviderId, setDragOverProviderId] = useState<string | null>(null)
  const [dropAfterProvider, setDropAfterProvider] = useState(false)
  const customPrompts = useRoxyStore((s) => s.customPrompts)
  const refreshCustomPrompts = useRoxyStore((s) => s.refreshCustomPrompts)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [promptName, setPromptName] = useState('')
  const [promptContent, setPromptContent] = useState('')
  const [creatingPrompt, setCreatingPrompt] = useState(false)
  const [setup, setSetup] = useState<{ seedId: string; connectionId?: string } | null>(null)
  const [addingAccount, setAddingAccount] = useState(false)
  const addAccountRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!addingAccount) addAccountRef.current?.focus()
  }, [addingAccount])

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

  const sortProvidersByName = (): void => {
    const sorted = [...providers].sort((a, b) => a.name.localeCompare(b.name)).map((p) => p.id)
    void reorderProviders(sorted)
  }

  useEffect(() => {
    setPrefix(settings?.branchPrefix ?? DEFAULT_BRANCH_PREFIX)
  }, [settings?.branchPrefix])

  useEffect(() => {
    setKeybind(settings?.overlayKeybind ?? 'CommandOrControl+Shift+Space')
  }, [settings?.overlayKeybind])

  useEffect(() => {
    setProfileName(settings?.userProfileName ?? '')
    setProfileAvatar(settings?.userProfileAvatar ?? '')
  }, [settings?.userProfileName, settings?.userProfileAvatar])

  const handleProfileImage = (file?: File): void => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) {
      setProfileError(t('settings.profile.invalidImage'))
      return
    }
    setProfileImageFile(file)
    setProfileError('')
  }

  const saveProfile = async (): Promise<void> => {
    setSavingProfile(true)
    setProfileError('')
    try {
      await setUserProfile({ name: profileName, avatar: profileAvatar })
    } catch {
      setProfileError(t('settings.profile.saveError'))
    } finally {
      setSavingProfile(false)
    }
  }

  useEffect(() => {
    setTtsOpenaiUrl(settings?.ttsOpenaiUrl ?? '')
    setTtsOpenaiModel(settings?.ttsOpenaiModel ?? '')
  }, [settings?.ttsOpenaiUrl, settings?.ttsOpenaiModel])

  const saveTtsOpenai = async (clearApiKey = false): Promise<void> => {
    setTtsOpenaiError('')
    try {
      await setTtsOpenaiConfig({
        url: ttsOpenaiUrl,
        model: ttsOpenaiModel,
        apiKey: ttsOpenaiKey,
        clearApiKey
      })
      setTtsOpenaiKey('')
    } catch (error) {
      setTtsOpenaiError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    let mounted = true
    void cameraManager.listDevices().then((devs) => mounted && setCameraList(devs))
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    refreshProviders()
    api.system.getVersions().then(setVersions)
    api.updates.getState().then(setUpdate)
    const off = api.updates.onStatus((state) =>
      setUpdate((prev) => (prev ? { ...prev, state } : { version: '', packaged: true, state }))
    )
    return off
  }, [refreshProviders])

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

  const handleResetVtuberPosition = async (): Promise<void> => {
    await resetVtuberPosition()
    setResetPositionSuccess(true)
    setTimeout(() => setResetPositionSuccess(false), 2000)
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
  const fishAudioModel = settings?.fishAudioModel ?? 's2.1-pro'

  const renderProviders = (): JSX.Element => (
    <>
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className={SECTION_HEADING}>{t('settings.providers.heading')}</h2>
          <div className="flex items-center gap-2">
            {providers.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={sortProvidersByName}
                title={t('settings.providers.sortByName')}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {t('settings.providers.sortByName')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSetup({ seedId: 'openai-compatible' })}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('settings.providers.add')}
            </Button>
            <Button
              size="sm"
              onClick={(e) => {
                addAccountRef.current = e.currentTarget
                setAddingAccount(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('settings.providers.addAccount')}
            </Button>
          </div>
        </div>
        <p className="mb-4 text-xs text-text-muted">{t('settings.providers.description')}</p>
        <div className="flex flex-col gap-2">
          {providers.map((p, index) => (
            <div
              key={p.id}
              onDragEnter={() =>
                dragProviderId && dragProviderId !== p.id && setDragOverProviderId(p.id)
              }
              onDragOver={(e) => {
                if (!dragProviderId || dragProviderId === p.id) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                const after = e.clientY - rect.top > rect.height / 2
                setDropAfterProvider(after)
                e.dataTransfer.dropEffect = 'move'
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                if (dragOverProviderId === p.id) {
                  setDragOverProviderId(null)
                  setDropAfterProvider(false)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const sourceId = e.dataTransfer.getData('text/plain') || dragProviderId
                if (sourceId && sourceId !== p.id) {
                  const ordered = reorderWithinProviders(
                    sourceId,
                    p.id,
                    dropAfterProvider ? 'after' : 'before'
                  )
                  if (ordered) void reorderProviders(ordered)
                }
                setDragProviderId(null)
                setDragOverProviderId(null)
                setDropAfterProvider(false)
              }}
              className={cn(
                'relative transition-all duration-150',
                dragProviderId === p.id && 'opacity-40',
                dragOverProviderId === p.id &&
                  (dropAfterProvider
                    ? 'after:absolute after:inset-x-2 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-accent'
                    : 'before:absolute before:inset-x-2 before:-top-1 before:h-0.5 before:rounded-full before:bg-accent')
              )}
            >
              <ProviderAccount
                provider={p}
                active={settings?.activeProviderId === p.id}
                onDragStart={(e) => {
                  setDragProviderId(p.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', p.id)
                }}
                onMoveUp={
                  index > 0
                    ? () => {
                        const order = reorderWithinProviders(
                          p.id,
                          providers[index - 1].id,
                          'before'
                        )
                        if (order) void reorderProviders(order)
                      }
                    : undefined
                }
                onMoveDown={
                  index < providers.length - 1
                    ? () => {
                        const order = reorderWithinProviders(p.id, providers[index + 1].id, 'after')
                        if (order) void reorderProviders(order)
                      }
                    : undefined
                }
                onAddAccount={() => setSetup({ seedId: p.seedId })}
                onReconnect={() => setSetup({ seedId: p.seedId, connectionId: p.id })}
              />
            </div>
          ))}
          {providers.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-subtle">
              {t('settings.providers.empty')}
            </p>
          )}
        </div>
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

  return (
    <PageShell
      title={t('settings.title')}
      contentKey={panel}
      sidebar={
        <>
          <label htmlFor="settings-section" className="sr-only">
            {t('settings.navigation.section')}
          </label>
          <select
            id="settings-section"
            value={panel}
            onChange={(event) => navigate('/settings/' + event.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text sm:hidden"
          >
            {SETTINGS_GROUPS.map((group) => (
              <optgroup key={group.label} label={t(group.label)}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <nav aria-label={t('settings.title')} className="hidden flex-col gap-5 sm:flex">
            {SETTINGS_GROUPS.map((group) => (
              <section key={group.label} aria-labelledby={group.label}>
                <h2
                  id={group.label}
                  className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle"
                >
                  {t(group.label)}
                </h2>
                <div className="flex flex-col gap-0.5">
                  {group.items.map(({ id, label, icon: Icon }) => (
                    <SidebarNavItem
                      key={id}
                      id={'settings-' + id}
                      aria-current={panel === id ? 'page' : undefined}
                      aria-controls={'settings-' + id + '-panel'}
                      onClick={() => navigate('/settings/' + id)}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1">{t(label)}</span>
                      {id === 'remote' && remotePhase !== 'idle' && remotePhase !== 'error' && (
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            remotePhase === 'live' ? 'bg-success' : 'bg-warning'
                          )}
                          title={t(
                            remotePhase === 'live'
                              ? 'sidebar.sharingLive'
                              : 'sidebar.sharingConnecting'
                          )}
                        />
                      )}
                    </SidebarNavItem>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </>
      }
      onBack={() => navigate('/')}
      onEscape={() => {
        if (resetting) return true
        if (promptDialogOpen) {
          if (!creatingPrompt) setPromptDialogOpen(false)
          return true
        }
        if (!confirmingReset) return false
        setConfirmingReset(false)
        return true
      }}
    >
      {addingAccount && (
        <AddAccount
          onClose={() => {
            setAddingAccount(false)
          }}
        />
      )}
      {setup && (
        <ProviderSetup
          modal
          seed={resolveSeed(setup.seedId)}
          connectionId={setup.connectionId}
          onClose={() => setSetup(null)}
        />
      )}
      <div
        id="settings-background-panel"
        role="region"
        aria-labelledby="settings-background"
        hidden={panel !== 'background'}
      >
        {(visited.has('background') || panel === 'background') && (
          <BackgroundSettings active={panel === 'background'} />
        )}
      </div>
      <div
        id="settings-colors-panel"
        role="region"
        aria-labelledby="settings-colors"
        hidden={panel !== 'colors'}
      >
        {(visited.has('colors') || panel === 'colors') && <Themes />}
      </div>
      <div
        id="settings-skills-panel"
        role="region"
        aria-labelledby="settings-skills"
        hidden={panel !== 'skills'}
      >
        {(visited.has('skills') || panel === 'skills') && <Skills active={panel === 'skills'} />}
      </div>
      <div
        id="settings-mcp-panel"
        role="region"
        aria-labelledby="settings-mcp"
        hidden={panel !== 'mcp'}
      >
        {(visited.has('mcp') || panel === 'mcp') && <Mcp active={panel === 'mcp'} />}
      </div>
      <div
        id="settings-activity-panel"
        role="region"
        aria-labelledby="settings-activity"
        hidden={panel !== 'activity'}
      >
        {(visited.has('activity') || panel === 'activity') && <ActivitySection />}
      </div>
      <div
        id="settings-motion-panel"
        role="region"
        aria-labelledby="settings-motion"
        hidden={panel !== 'motion'}
      >
        {(visited.has('motion') || panel === 'motion') && <MotionSettings onChange={setMotion} />}
      </div>
      <section
        id="settings-remote-panel"
        role="region"
        aria-labelledby="settings-remote"
        hidden={panel !== 'remote'}
      >
        <h2 className={SECTION_HEADING}>{t('remote.title')}</h2>
        <p className="mb-4 text-sm text-text-muted">{t('remote.idleBody')}</p>
        <Button onClick={() => setRemoteOpen(true)}>
          <MonitorSmartphone className="h-4 w-4" />
          {t('settings.navigation.openRemote')}
        </Button>
      </section>
      {remoteOpen && <RemoteWorkspaceDialog onClose={() => setRemoteOpen(false)} />}
      <section
        id="settings-voice-panel"
        role="region"
        aria-labelledby="settings-voice"
        hidden={panel !== 'voice'}
      >
        {(visited.has('voice') || panel === 'voice') && <VoiceSettings />}
      </section>

      <div
        id="settings-accounts-panel"
        role="region"
        aria-labelledby="settings-accounts"
        hidden={panel !== 'accounts'}
      >
        {renderProviders()}
      </div>

      {/* A native <select> on purpose. The picker is read once and then never
          again, so it earns none of the cost of a custom popover -- and the
          native control already gives us type-ahead, keyboard nav and the OS's
          own font stack, which matters for scripts the app font may not cover. */}
      <section
        id="settings-language-panel"
        role="region"
        aria-labelledby="settings-language"
        hidden={panel !== 'language'}
        className="mb-8"
      >
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

      <section
        id="settings-notifications-panel"
        role="region"
        aria-labelledby="settings-notifications"
        hidden={panel !== 'notifications'}
        className="mb-8"
      >
        <h2 className={SECTION_HEADING}>{t('settings.notifications.heading')}</h2>
        <NotificationSettings />
      </section>

      <section
        id="settings-worktrees-panel"
        role="region"
        aria-labelledby="settings-worktrees"
        hidden={panel !== 'worktrees'}
        className="mb-8"
      >
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
                'w-48 max-w-full sq sq-lg sq-ring rounded-lg border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle',
                prefixError
                  ? 'border-danger [--sq-ring:var(--color-danger)]'
                  : 'border-border focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)]'
              )}
            />
            {/* The example is the point: "roxy" in a box means nothing until
                you see a whole branch name next to it. Uses a real session
                slug, because that is what branches actually look like. */}
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

      <section
        id="settings-browser-panel"
        role="region"
        aria-labelledby="settings-browser"
        hidden={panel !== 'browser'}
        className="mb-8"
      >
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
          <div
            className={cn(
              'flex items-start justify-between gap-4 p-4',
              cookiesOpen && 'border-b border-border'
            )}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">
                {t('settings.browser.cookiesTitle')}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {t('settings.browser.cookiesDescription')}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-8 shrink-0 px-0"
              aria-expanded={cookiesOpen}
              aria-controls={cookiesPanelId}
              title={
                cookiesOpen
                  ? t('settings.browser.cookiesCollapse')
                  : t('settings.browser.cookiesExpand')
              }
              onClick={() => setCookiesOpen((v) => !v)}
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', cookiesOpen && 'rotate-180')}
              />
            </Button>
          </div>
          <div id={cookiesPanelId} hidden={!cookiesOpen}>
            {cookiesOpen && <CookiePanel className="max-h-[420px]" />}
          </div>
        </div>

        <div className="mt-3 overflow-hidden sq sq-xl sq-ring rounded-xl border border-border bg-surface">
          <ProxyPanel />
        </div>
      </section>

      <section
        id="settings-backup-panel"
        role="region"
        aria-labelledby="settings-backup"
        hidden={panel !== 'backup'}
        className="mb-8"
      >
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

      <section
        id="settings-privacy-panel"
        role="region"
        aria-labelledby="settings-privacy"
        hidden={panel !== 'privacy'}
        className="mb-8"
      >
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
      <section
        id="settings-about-panel"
        role="region"
        aria-labelledby="settings-about"
        hidden={panel !== 'about'}
        className="mb-8"
      >
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

      <section hidden={panel !== 'about'} className="mt-8">
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

      <div
        id="settings-profile-panel"
        role="region"
        aria-labelledby="settings-profile"
        hidden={panel !== 'profile'}
      >
        <section className="mb-8">
          <h2 className={SECTION_HEADING}>{t('settings.profile.heading')}</h2>
          <form
            className="sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault()
              void saveProfile()
            }}
          >
            <p className="mb-4 text-xs text-text-muted">{t('settings.profile.description')}</p>
            <div className="flex flex-wrap items-center gap-4">
              {profileAvatar ? (
                <img src={profileAvatar} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : (
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-text-muted"
                  aria-hidden="true"
                >
                  {(profileName || t('transcript.you')).charAt(0)}
                </div>
              )}
              <label className="cursor-pointer rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text hover:bg-surface-3">
                {t('settings.profile.chooseImage')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    handleProfileImage(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </label>
              {profileAvatar && (
                <button
                  type="button"
                  className="text-xs text-text-muted hover:text-text"
                  onClick={() => setProfileAvatar('')}
                >
                  {t('settings.profile.removeImage')}
                </button>
              )}
            </div>
            {profileImageFile && (
              <ProfileImageCropper
                file={profileImageFile}
                onCancel={() => setProfileImageFile(null)}
                onApply={(dataUrl) => {
                  setProfileAvatar(dataUrl)
                  setProfileImageFile(null)
                }}
              />
            )}
            <label className="mt-4 grid max-w-sm gap-1 text-xs text-text-muted">
              {t('settings.profile.name')}
              <input
                value={profileName}
                maxLength={80}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder={t('transcript.you')}
                className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
              />
            </label>
            {profileError && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {profileError}
              </p>
            )}
            <Button
              type="submit"
              className="mt-4"
              disabled={
                savingProfile ||
                profileImageFile !== null ||
                (profileName === (settings?.userProfileName ?? '') &&
                  profileAvatar === (settings?.userProfileAvatar ?? ''))
              }
            >
              {t('common.save')}
            </Button>
          </form>
        </section>
      </div>

      <div
        id="settings-overlay-panel"
        role="region"
        aria-labelledby="settings-overlay"
        hidden={panel !== 'overlay'}
      >
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
            <div className="text-sm font-medium text-text">
              {t('settings.overlay.keybindTitle')}
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('settings.overlay.keybindDescription')}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                value={keybind}
                onKeyDown={handleKeybindDown}
                onKeyUp={handleKeybindUp}
                onBlur={() =>
                  setKeybind(settings?.overlayKeybind ?? 'CommandOrControl+Shift+Space')
                }
                readOnly
                spellCheck={false}
                placeholder="Click to record keybind"
                className="w-64 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text outline-none placeholder:text-text-subtle focus:border-border-strong focus:[--sq-ring:var(--color-border-strong)] cursor-pointer"
              />
            </div>
          </div>
        </section>
      </div>

      <div
        id="settings-discord-panel"
        role="region"
        aria-labelledby="settings-discord"
        hidden={panel !== 'discord'}
      >
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
      </div>

      <div
        id="settings-tts-panel"
        role="region"
        aria-labelledby="settings-tts"
        hidden={panel !== 'tts'}
      >
        <>
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
                    onChange={(e) =>
                      void setTtsProvider(e.target.value as 'local' | 'fish' | 'openai')
                    }
                    className="h-9 shrink-0 sq sq-lg sq-ring rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors focus:border-accent/70"
                  >
                    <option value="local">{t('settings.tts.providerLocal')}</option>
                    <option value="fish">{t('settings.tts.providerFish')}</option>
                    <option value="openai">{t('settings.tts.providerOpenai')}</option>
                  </select>
                </div>

                {ttsProvider === 'openai' ? (
                  <div className="mt-3 sq sq-xl sq-ring rounded-xl border border-border bg-surface p-4">
                    <form
                      className="grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void saveTtsOpenai()
                      }}
                    >
                      <label className="grid gap-1 text-xs text-text-muted">
                        {t('settings.tts.openaiEndpoint')}
                        <input
                          type="url"
                          required
                          value={ttsOpenaiUrl}
                          onChange={(e) => setTtsOpenaiUrl(e.target.value)}
                          placeholder="https://example.com/v1/audio/speech"
                          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-text-muted">
                        {t('settings.tts.openaiModel')}
                        <input
                          required
                          value={ttsOpenaiModel}
                          onChange={(e) => setTtsOpenaiModel(e.target.value)}
                          placeholder="fish/s2.1-pro-free"
                          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-text-muted">
                        {t('settings.tts.openaiKey')}
                        <input
                          type="password"
                          autoComplete="off"
                          value={ttsOpenaiKey}
                          onChange={(e) => setTtsOpenaiKey(e.target.value)}
                          placeholder={
                            settings?.ttsOpenaiHasApiKey ? t('settings.tts.openaiKeySaved') : 'sk-…'
                          }
                          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text"
                        />
                      </label>
                      <div className="flex items-center gap-3">
                        <Button type="submit" size="sm">
                          {t('settings.tts.openaiSave')}
                        </Button>
                        {settings?.ttsOpenaiHasApiKey && (
                          <button
                            type="button"
                            onClick={() => void saveTtsOpenai(true)}
                            className="text-xs text-text-muted hover:text-text"
                          >
                            {t('settings.tts.openaiClearKey')}
                          </button>
                        )}
                      </div>
                    </form>
                    {ttsOpenaiError && (
                      <p role="alert" className="mt-2 text-xs text-red-400">
                        {ttsOpenaiError}
                      </p>
                    )}
                    <Button
                      variant="secondary"
                      className="mt-3"
                      onClick={() => void handleTestVoice()}
                      disabled={
                        testingVoice || !settings?.ttsOpenaiUrl || !settings?.ttsOpenaiModel
                      }
                    >
                      {testingVoice
                        ? t('settings.tts.testingVoice')
                        : t('settings.tts.testVoiceButton')}
                    </Button>
                    {testVoiceFeedback && (
                      <p className="mt-2 text-xs text-text-muted">{testVoiceFeedback}</p>
                    )}
                  </div>
                ) : ttsProvider === 'fish' ? (
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
      </div>

      <div
        id="settings-vtuber-panel"
        role="region"
        aria-labelledby="settings-vtuber"
        hidden={panel !== 'vtuber'}
      >
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
      </div>

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
