import { memo, useState } from 'react'
import { BackgroundFrame } from '../components/BackgroundFrame'
import { Sidebar, type SidebarTool } from '../components/Sidebar'
import { ChatView } from '../components/ChatView'
import { TopNavbar } from '../components/TopNavbar'
import { useBackground } from '../lib/background'
import { useRoxyStore } from '../lib/store'
import { WORKSPACE_OPEN_TOOL } from '../lib/workspace-navigation'

function Chat(): JSX.Element {
  const [selection, setSelection] = useState<{
    sessionId: string | null
    tool: SidebarTool | null
  } | null>(null)
  const activeChatId = useRoxyStore((state) => state.activeChatId)
  // The docked terminal also opens from the top bar, the composer and Ctrl+`,
  // so the store — not the last rail click — says whether it is showing.
  const terminalOpen = useRoxyStore((state) => state.commandsOpen)
  const background = useBackground()
  const shared = !!background.rendered && background.settings.sidebarStyle !== 'default'
  const picked = selection?.sessionId === activeChatId ? selection.tool : null
  const tool: SidebarTool | null = terminalOpen ? 'terminal' : picked === 'terminal' ? null : picked
  const changeTool = (next: SidebarTool | null): void => {
    setSelection({ sessionId: activeChatId, tool: next })
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_OPEN_TOOL, { detail: { sessionId: activeChatId, tab: next } })
    )
  }
  return (
    <BackgroundFrame className="relative flex h-full flex-col overflow-hidden bg-bg">
      <TopNavbar />
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        <Sidebar tool={tool} onToolChange={changeTool} />
        <main
          className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${shared ? 'bg-transparent' : 'bg-bg'}`}
        >
          <ChatView />
        </main>
      </div>
    </BackgroundFrame>
  )
}

export default memo(Chat)
