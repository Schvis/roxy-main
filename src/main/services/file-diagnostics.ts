import { existsSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { WorkspaceFileDiagnostic } from '../../shared/api'

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
}

const IGNORED_DIAGNOSTIC_CODES = new Set([
  6307, // File is not listed within the file list of project
  6305, // Output file has not been built from source file
  6306, // File is part of a project reference cycle
  5055, // Cannot write file because it would overwrite input file
  5056, // Cannot write file because it will overwrite input file
  5083, // Cannot read file
  6133, // Variable is declared but its value is never read
  6192, // All imports in import declaration are unused
  6196, // All variables are unused
  2688 // Cannot find type definition file
])

interface DiagnosticProject {
  path: string
  parsed: ts.ParsedCommandLine
  errors: ts.Diagnostic[]
}

function findDiagnosticProject(root: string, target: string): DiagnosticProject | undefined {
  const visited = new Set<string>()
  const candidates: DiagnosticProject[] = []
  const isJavaScript = /\.[cm]?jsx?$/i.test(target)

  const visit = (configPath: string): void => {
    const absolute = path.resolve(configPath)
    if (!isContained(root, absolute) || visited.has(absolute)) return
    visited.add(absolute)
    const config = ts.readConfigFile(absolute.replace(/\\/g, '/'), ts.sys.readFile)
    if (config.error) {
      candidates.push({
        path: absolute,
        parsed: { options: {}, fileNames: [], errors: [] },
        errors: [config.error]
      })
      return
    }
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.dirname(absolute),
      path.basename(absolute) === 'jsconfig.json' ? { allowJs: true } : undefined
    )
    candidates.push({ path: absolute, parsed, errors: parsed.errors })
    for (const reference of parsed.projectReferences ?? []) {
      visit(ts.resolveProjectReferencePath(reference))
    }
  }

  let directory = path.dirname(target)
  while (isContained(root, directory)) {
    for (const name of isJavaScript
      ? ['tsconfig.json', 'jsconfig.json', 'tsconfig.web.json', 'tsconfig.node.json']
      : ['tsconfig.json', 'tsconfig.web.json', 'tsconfig.node.json']) {
      const configPath = path.join(directory, name)
      if (ts.sys.fileExists(configPath)) visit(configPath)
    }
    if (directory === root) break
    directory = path.dirname(directory)
  }

  const ownsTarget = (project: DiagnosticProject): boolean =>
    project.parsed.fileNames.some(
      (file) => path.resolve(file).toLowerCase() === target.toLowerCase()
    )
  const distance = (project: DiagnosticProject): number =>
    path.relative(path.dirname(project.path), target).split(path.sep).length
  // Nearest owning config wins. A solution config (files: [], references: [...])
  // does not own its referenced files; use the referenced project's options.
  return (
    candidates.filter(ownsTarget).sort((a, b) => distance(a) - distance(b))[0] ??
    candidates.find((candidate) =>
      ['tsconfig.json', 'jsconfig.json'].includes(path.basename(candidate.path))
    ) ??
    candidates[0]
  )
}

export function computeFileDiagnostics(
  root: string,
  target: string,
  lexical: string,
  content: string,
  resourcesPath?: string
): WorkspaceFileDiagnostic[] {
  const isJsTs = /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(lexical)
  const isJson = /\.json$/i.test(lexical)

  if (isJson) {
    const source = ts.parseJsonText(lexical.replace(/\\/g, '/'), content)
    const diagnostics =
      (source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
    return diagnostics.map((d) => {
      const start = d.start ?? 0
      const pos = source.getLineAndCharacterOfPosition(start)
      return {
        line: pos.line + 1,
        column: pos.character + 1,
        start,
        length: d.length ?? 0,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n')
      }
    })
  }

  if (!isJsTs) return []

  const targetAbs = target
  const project = findDiagnosticProject(root, targetAbs)

  let compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true
  }

  if (project?.errors.length) {
    return project.errors.map((error) => ({
      line: 1,
      column: 1,
      start: 0,
      length: 0,
      code: error.code,
      message: `${path.basename(project.path)}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`
    }))
  }
  if (project) {
    compilerOptions = {
      ...compilerOptions,
      ...project.parsed.options,
      noEmit: true,
      skipLibCheck: true
    }
  }

  // Electron reports its own executable as TypeScript's executing file. Anchor
  // standard libraries to the installed compiler instead of the Electron binary.
  // electron-builder excludes *.d.ts from app.asar; packaged libs live in resources.
  const installedLibDirectory = path.dirname(require.resolve('typescript'))
  const libDirectory = existsSync(path.join(installedLibDirectory, 'lib.d.ts'))
    ? installedLibDirectory
    : path.join(resourcesPath ?? '', 'typescript', 'lib')
  if (!existsSync(path.join(libDirectory, 'lib.d.ts'))) {
    return [
      {
        line: 1,
        column: 1,
        start: 0,
        length: 0,
        code: 6053,
        message: 'TypeScript standard libraries are missing from the application installation.'
      }
    ]
  }
  const baseHost = ts.createCompilerHost(compilerOptions)
  const host: ts.CompilerHost = {
    ...baseHost,
    getDefaultLibLocation: () => libDirectory,
    getDefaultLibFileName: (options) =>
      path.join(libDirectory, path.basename(ts.getDefaultLibFilePath(options))),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (path.resolve(fileName).toLowerCase() === targetAbs.toLowerCase()) {
        return ts.createSourceFile(fileName, content, languageVersion, true)
      }
      return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
    },
    readFile: (fileName) => {
      if (path.resolve(fileName).toLowerCase() === targetAbs.toLowerCase()) return content
      return baseHost.readFile(fileName)
    },
    fileExists: (fileName) => {
      if (path.resolve(fileName).toLowerCase() === targetAbs.toLowerCase()) return true
      return baseHost.fileExists(fileName)
    }
  }

  const program = ts.createProgram(
    project ? [...new Set([...project.parsed.fileNames, targetAbs])] : [targetAbs],
    compilerOptions,
    host
  )
  const source = program.getSourceFile(targetAbs)
  if (!source) return []

  const syntactic = program.getSyntacticDiagnostics(source)
  const semantic = program.getSemanticDiagnostics(source).filter((d) => {
    if (d.file !== source) return false
    if (IGNORED_DIAGNOSTIC_CODES.has(d.code)) return false
    return true
  })

  return [...syntactic, ...semantic].map((d) => {
    const start = d.start ?? 0
    const pos = source.getLineAndCharacterOfPosition(start)
    return {
      line: pos.line + 1,
      column: pos.character + 1,
      start,
      length: d.length ?? 0,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n')
    }
  })
}
