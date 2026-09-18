import type { LucideIcon } from 'lucide-react'
import {
  Binary,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileDiff,
  FileImage,
  FileJson,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideo
} from 'lucide-react'

export interface FileIconDescriptor {
  Icon: LucideIcon
  color: string
}

const EXACT_FILES: Record<string, FileIconDescriptor> = {
  // Lock files
  'package-lock.json': { Icon: FileLock, color: 'text-slate-400' },
  'pnpm-lock.yaml': { Icon: FileLock, color: 'text-slate-400' },
  'yarn.lock': { Icon: FileLock, color: 'text-slate-400' },
  'cargo.lock': { Icon: FileLock, color: 'text-slate-400' },
  'gemfile.lock': { Icon: FileLock, color: 'text-slate-400' },
  'composer.lock': { Icon: FileLock, color: 'text-slate-400' },
  'flake.lock': { Icon: FileLock, color: 'text-slate-400' },
  'poetry.lock': { Icon: FileLock, color: 'text-slate-400' },

  // Git & ignore files
  '.gitignore': { Icon: FileDiff, color: 'text-slate-400' },
  '.gitattributes': { Icon: FileDiff, color: 'text-slate-400' },
  '.gitmodules': { Icon: FileDiff, color: 'text-slate-400' },
  '.gitkeep': { Icon: FileDiff, color: 'text-slate-400' },
  '.prettierignore': { Icon: FileDiff, color: 'text-slate-400' },
  '.eslintignore': { Icon: FileDiff, color: 'text-slate-400' },
  '.dockerignore': { Icon: FileDiff, color: 'text-slate-400' },
  '.npmignore': { Icon: FileDiff, color: 'text-slate-400' },

  // Docker
  dockerfile: { Icon: FileCode, color: 'text-sky-400' },
  'docker-compose.yml': { Icon: FileText, color: 'text-purple-400' },
  'docker-compose.yaml': { Icon: FileText, color: 'text-purple-400' },
  containerfile: { Icon: FileCode, color: 'text-sky-400' },

  // Config files
  'tsconfig.json': { Icon: FileCode, color: 'text-blue-400' },
  'tsconfig.node.json': { Icon: FileCode, color: 'text-blue-400' },
  'tsconfig.web.json': { Icon: FileCode, color: 'text-blue-400' },
  'jsconfig.json': { Icon: FileCode, color: 'text-yellow-400' },
  '.editorconfig': { Icon: FileCog, color: 'text-slate-400' },
  'cargo.toml': { Icon: FileCog, color: 'text-slate-400' }
}

const EXTENSION_MAP: Record<string, FileIconDescriptor> = {
  // TypeScript & JavaScript
  ts: { Icon: FileCode, color: 'text-blue-400' },
  tsx: { Icon: FileCode, color: 'text-blue-400' },
  mts: { Icon: FileCode, color: 'text-blue-400' },
  cts: { Icon: FileCode, color: 'text-blue-400' },
  js: { Icon: FileCode, color: 'text-yellow-400' },
  jsx: { Icon: FileCode, color: 'text-yellow-400' },
  mjs: { Icon: FileCode, color: 'text-yellow-400' },
  cjs: { Icon: FileCode, color: 'text-yellow-400' },

  // Programming languages
  py: { Icon: FileCode, color: 'text-emerald-400' },
  pyw: { Icon: FileCode, color: 'text-emerald-400' },
  ipynb: { Icon: FileCode, color: 'text-orange-400' },
  rs: { Icon: FileCode, color: 'text-orange-400' },
  go: { Icon: FileCode, color: 'text-cyan-400' },
  c: { Icon: FileCode, color: 'text-blue-500' },
  h: { Icon: FileCode, color: 'text-blue-500' },
  cpp: { Icon: FileCode, color: 'text-blue-500' },
  hpp: { Icon: FileCode, color: 'text-blue-500' },
  cc: { Icon: FileCode, color: 'text-blue-500' },
  cxx: { Icon: FileCode, color: 'text-blue-500' },
  java: { Icon: FileCode, color: 'text-amber-600' },
  kt: { Icon: FileCode, color: 'text-purple-400' },
  kts: { Icon: FileCode, color: 'text-purple-400' },
  scala: { Icon: FileCode, color: 'text-rose-500' },
  cs: { Icon: FileCode, color: 'text-purple-400' },
  fs: { Icon: FileCode, color: 'text-cyan-400' },
  php: { Icon: FileCode, color: 'text-indigo-400' },
  rb: { Icon: FileCode, color: 'text-rose-400' },
  swift: { Icon: FileCode, color: 'text-orange-500' },
  dart: { Icon: FileCode, color: 'text-cyan-400' },
  vue: { Icon: FileCode, color: 'text-emerald-400' },
  svelte: { Icon: FileCode, color: 'text-orange-500' },
  astro: { Icon: FileCode, color: 'text-orange-400' },
  zig: { Icon: FileCode, color: 'text-amber-500' },
  lua: { Icon: FileCode, color: 'text-blue-400' },
  pl: { Icon: FileCode, color: 'text-sky-400' },
  pm: { Icon: FileCode, color: 'text-sky-400' },
  r: { Icon: FileCode, color: 'text-blue-400' },
  ex: { Icon: FileCode, color: 'text-purple-400' },
  exs: { Icon: FileCode, color: 'text-purple-400' },
  hs: { Icon: FileCode, color: 'text-purple-400' },
  ml: { Icon: FileCode, color: 'text-amber-500' },

  // Web & Styles
  html: { Icon: FileCode, color: 'text-orange-500' },
  htm: { Icon: FileCode, color: 'text-orange-500' },
  xml: { Icon: FileCode, color: 'text-amber-400' },
  svg: { Icon: FileCode, color: 'text-amber-400' },
  css: { Icon: FileCode, color: 'text-sky-400' },
  scss: { Icon: FileCode, color: 'text-pink-400' },
  sass: { Icon: FileCode, color: 'text-pink-400' },
  less: { Icon: FileCode, color: 'text-indigo-400' },
  styl: { Icon: FileCode, color: 'text-emerald-400' },
  pcss: { Icon: FileCode, color: 'text-orange-400' },

  // Data & Config
  json: { Icon: FileJson, color: 'text-yellow-400' },
  json5: { Icon: FileJson, color: 'text-yellow-400' },
  jsonc: { Icon: FileJson, color: 'text-yellow-400' },
  geojson: { Icon: FileJson, color: 'text-yellow-400' },
  yaml: { Icon: FileText, color: 'text-purple-400' },
  yml: { Icon: FileText, color: 'text-purple-400' },
  toml: { Icon: FileCog, color: 'text-slate-400' },
  ini: { Icon: FileCog, color: 'text-slate-400' },
  conf: { Icon: FileCog, color: 'text-slate-400' },
  cfg: { Icon: FileCog, color: 'text-slate-400' },
  properties: { Icon: FileCog, color: 'text-slate-400' },
  csv: { Icon: FileSpreadsheet, color: 'text-emerald-500' },
  tsv: { Icon: FileSpreadsheet, color: 'text-emerald-500' },
  xls: { Icon: FileSpreadsheet, color: 'text-emerald-500' },
  xlsx: { Icon: FileSpreadsheet, color: 'text-emerald-500' },

  // Database & SQL
  sql: { Icon: Database, color: 'text-cyan-400' },
  db: { Icon: Database, color: 'text-cyan-400' },
  sqlite: { Icon: Database, color: 'text-cyan-400' },
  sqlite3: { Icon: Database, color: 'text-cyan-400' },
  prisma: { Icon: Database, color: 'text-teal-400' },

  // Shell & Scripts
  sh: { Icon: FileTerminal, color: 'text-emerald-400' },
  bash: { Icon: FileTerminal, color: 'text-emerald-400' },
  zsh: { Icon: FileTerminal, color: 'text-emerald-400' },
  fish: { Icon: FileTerminal, color: 'text-emerald-400' },
  bat: { Icon: FileTerminal, color: 'text-emerald-400' },
  cmd: { Icon: FileTerminal, color: 'text-emerald-400' },
  ps1: { Icon: FileTerminal, color: 'text-blue-400' },
  psm1: { Icon: FileTerminal, color: 'text-blue-400' },
  psd1: { Icon: FileTerminal, color: 'text-blue-400' },

  // Images
  png: { Icon: FileImage, color: 'text-purple-400' },
  jpg: { Icon: FileImage, color: 'text-purple-400' },
  jpeg: { Icon: FileImage, color: 'text-purple-400' },
  gif: { Icon: FileImage, color: 'text-purple-400' },
  webp: { Icon: FileImage, color: 'text-purple-400' },
  ico: { Icon: FileImage, color: 'text-purple-400' },
  bmp: { Icon: FileImage, color: 'text-purple-400' },
  avif: { Icon: FileImage, color: 'text-purple-400' },
  tiff: { Icon: FileImage, color: 'text-purple-400' },

  // Audio
  mp3: { Icon: FileAudio, color: 'text-violet-400' },
  wav: { Icon: FileAudio, color: 'text-violet-400' },
  ogg: { Icon: FileAudio, color: 'text-violet-400' },
  flac: { Icon: FileAudio, color: 'text-violet-400' },
  m4a: { Icon: FileAudio, color: 'text-violet-400' },
  aac: { Icon: FileAudio, color: 'text-violet-400' },
  opus: { Icon: FileAudio, color: 'text-violet-400' },

  // Video
  mp4: { Icon: FileVideo, color: 'text-pink-400' },
  mkv: { Icon: FileVideo, color: 'text-pink-400' },
  avi: { Icon: FileVideo, color: 'text-pink-400' },
  mov: { Icon: FileVideo, color: 'text-pink-400' },
  webm: { Icon: FileVideo, color: 'text-pink-400' },

  // Archives
  zip: { Icon: FileArchive, color: 'text-amber-600' },
  tar: { Icon: FileArchive, color: 'text-amber-600' },
  gz: { Icon: FileArchive, color: 'text-amber-600' },
  tgz: { Icon: FileArchive, color: 'text-amber-600' },
  '7z': { Icon: FileArchive, color: 'text-amber-600' },
  rar: { Icon: FileArchive, color: 'text-amber-600' },
  bz2: { Icon: FileArchive, color: 'text-amber-600' },
  xz: { Icon: FileArchive, color: 'text-amber-600' },

  // Documents & Text
  md: { Icon: FileText, color: 'text-sky-300' },
  markdown: { Icon: FileText, color: 'text-sky-300' },
  mdx: { Icon: FileText, color: 'text-sky-300' },
  txt: { Icon: FileText, color: 'text-text-muted' },
  rtf: { Icon: FileText, color: 'text-text-muted' },
  doc: { Icon: FileText, color: 'text-blue-400' },
  docx: { Icon: FileText, color: 'text-blue-400' },
  pdf: { Icon: FileText, color: 'text-rose-400' },
  log: { Icon: FileText, color: 'text-text-subtle' },

  // Keys & Certs
  pem: { Icon: FileKey, color: 'text-amber-400' },
  key: { Icon: FileKey, color: 'text-amber-400' },
  crt: { Icon: FileKey, color: 'text-amber-400' },
  cer: { Icon: FileKey, color: 'text-amber-400' },
  pub: { Icon: FileKey, color: 'text-amber-400' },
  asc: { Icon: FileKey, color: 'text-amber-400' },

  // Lock
  lock: { Icon: FileLock, color: 'text-slate-400' },

  // Diffs
  diff: { Icon: FileDiff, color: 'text-teal-400' },
  patch: { Icon: FileDiff, color: 'text-teal-400' },

  // Binary & native
  wasm: { Icon: Binary, color: 'text-text-subtle' },
  bin: { Icon: Binary, color: 'text-text-subtle' },
  exe: { Icon: Binary, color: 'text-text-subtle' },
  dll: { Icon: Binary, color: 'text-text-subtle' },
  so: { Icon: Binary, color: 'text-text-subtle' },
  dylib: { Icon: Binary, color: 'text-text-subtle' }
}

const DEFAULT_FILE: FileIconDescriptor = {
  Icon: File,
  color: 'text-text-muted'
}

export function getFileIconDescriptor(filePathOrName: string): FileIconDescriptor {
  if (!filePathOrName) return DEFAULT_FILE
  const name = filePathOrName.split(/[\\/]/).pop() || filePathOrName
  const lower = name.toLowerCase()

  // 1. Exact match
  if (EXACT_FILES[lower]) {
    return EXACT_FILES[lower]
  }

  // 2. Pattern matches (ignore, config, env, docs)
  if (lower.endsWith('ignore')) {
    return { Icon: FileDiff, color: 'text-slate-400' }
  }
  if (lower.startsWith('.env')) {
    return { Icon: FileCog, color: 'text-slate-400' }
  }
  if (
    lower.startsWith('.eslint') &&
    !lower.endsWith('.js') &&
    !lower.endsWith('.ts') &&
    !lower.endsWith('.mjs') &&
    !lower.endsWith('.cjs')
  ) {
    return { Icon: FileCog, color: 'text-slate-400' }
  }
  if (
    lower.startsWith('.prettier') &&
    !lower.endsWith('.js') &&
    !lower.endsWith('.ts') &&
    !lower.endsWith('.mjs') &&
    !lower.endsWith('.cjs')
  ) {
    return { Icon: FileCog, color: 'text-slate-400' }
  }
  if (lower.startsWith('readme') || lower.startsWith('license') || lower.startsWith('changelog')) {
    return { Icon: FileText, color: 'text-text-muted' }
  }

  // 3. Extension match
  const dotIndex = lower.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < lower.length - 1) {
    const ext = lower.slice(dotIndex + 1)
    const match = EXTENSION_MAP[ext]
    if (match) return match
  }

  return DEFAULT_FILE
}

export function getFileIcon(filePathOrName: string): LucideIcon {
  return getFileIconDescriptor(filePathOrName).Icon
}
