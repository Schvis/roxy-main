/**
 * Template mapping of headpat voiceline audio files to speech bubble messages.
 * Fill in the desired text for each audio file below.
 */
export const HEADPAT_MESSAGES: Record<string, string> = {
  'headpat1.mp3': 'That tickles...',
  'headpat2.mp3': 'Im not a kid anymore...',
  'headpat3.mp3': 'Stop treating me like a kid...',
  'headpat4.mp3': 'You gonna make a mess of my hair again...'
}

export function getHeadpatMessage(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop() || fileName
  return HEADPAT_MESSAGES[cleanName] || HEADPAT_MESSAGES[fileName] || ''
}
