// Stand-ins for the app-bound modules shell-session imports, so the smoke can
// drive real shells from plain node. Aliased in by `npm run smoke:shell`.

/** workspace.ts — a chat's cwd. The smoke runs in the repo. */
export function sessionCwd(): string {
  return process.cwd()
}

/** overlay.ts — no overlay windows exist here. */
export function isFloatingIconWindow(): boolean {
  return false
}
export function isVtuberWindow(): boolean {
  return false
}
