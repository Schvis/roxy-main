import { useEffect, useState } from 'react'
import { api } from './api'

/** Counts of discovered skills + configured MCP servers, refreshed when focused. */
export function useCustomizeCounts(): { skills: number; mcp: number } {
  const [counts, setCounts] = useState<{ skills: number; mcp: number }>({ skills: 0, mcp: 0 })
  useEffect(() => {
    let alive = true
    const load = (): void => {
      Promise.all([api.skills.list(), api.mcp.list()])
        .then(([skills, mcp]) => {
          if (alive) setCounts({ skills: skills.length, mcp: mcp.length })
        })
        .catch(() => {})
    }
    load()
    // Re-count when the window regains focus (the user may have edited skills/MCP on a page).
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [])
  return counts
}
