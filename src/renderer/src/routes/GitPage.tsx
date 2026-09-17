import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '../components/PageShell'
import { GitActionsView } from '../components/GitActionsView'
import { useRoxyStore } from '../lib/store'

export default function GitPage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const activeChatId = useRoxyStore((s) => s.activeChatId)
  const chats = useRoxyStore((s) => s.chats)
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const parentChat = chats.find((chat) => chat.id === activeChat?.parentId)
  const root =
    activeChat?.worktreePath ??
    activeChat?.workspacePath ??
    parentChat?.worktreePath ??
    parentChat?.workspacePath ??
    null

  return (
    <PageShell title={t('git.title')} subtitle={t('git.subtitle')} onBack={() => navigate('/')}>
      <div className="h-[calc(100vh-140px)] w-full rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
        <GitActionsView root={root} sessionId={activeChatId} isStandalone />
      </div>
    </PageShell>
  )
}
