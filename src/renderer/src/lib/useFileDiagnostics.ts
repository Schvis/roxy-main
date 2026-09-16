import { useEffect, useRef, useState } from 'react'
import type { WorkspaceFileDiagnostic } from '@shared/api'
import { api } from './api'

type Status = 'checking' | 'ready' | 'unsupported' | 'tooLarge' | 'failed'

export function useFileDiagnostics(
  sessionId: string,
  path: string,
  text: string,
  enabled: boolean
): { status: Status; issues: WorkspaceFileDiagnostic[] } {
  const sequence = useRef(0)
  const [result, setResult] = useState<{
    path: string
    text: string
    status: Status
    issues: WorkspaceFileDiagnostic[]
  } | null>(null)

  const supported = /\.(?:[cm]?[jt]s|[jt]sx|json)$/i.test(path)
  const tooLarge = text.length > 300_000 || text.split('\n').length > 8000

  useEffect(() => {
    const id = ++sequence.current
    if (!enabled || !supported || tooLarge || !sessionId) return
    let current = true
    const timer = window.setTimeout(() => {
      void api.files.diagnostics(sessionId, path, text).then(
        (issues) => {
          if (current && sequence.current === id) {
            setResult({ path, text, status: 'ready', issues })
          }
        },
        () => {
          if (current && sequence.current === id) {
            setResult({ path, text, status: 'failed', issues: [] })
          }
        }
      )
    }, 300)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [sessionId, path, text, enabled, supported, tooLarge])

  if (!supported) return { status: 'unsupported', issues: [] }
  if (tooLarge) return { status: 'tooLarge', issues: [] }
  if (!enabled || result?.path !== path) return { status: 'checking', issues: [] }
  if (result.text !== text) return { status: 'checking', issues: result.issues }
  return result
}
