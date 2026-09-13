/**
 * Template mapping of chest poke voiceline audio files to speech bubble messages.
 * Fill in the desired text for each audio file below.
 */
export const CHEST_MESSAGES: Record<string, string> = {
  'chest1.mp3': 'H-hey! Where do you think you are touching?!',
  'chest2.mp3': 'What are you doing?! Stop that!',
  'chest3.mp3': 'P-pervert...',
  'chest4.mp3': 'D-dont poke me there!'
}

export function getChestMessage(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop() || fileName
  return CHEST_MESSAGES[cleanName] || CHEST_MESSAGES[fileName] || ''
}

/**
 * Placeholder voiceline files for the chest interaction.
 * Drop the real recordings into resources/voicelines/chest/ later.
 */
export const CHEST_VOICELINE_FILES = ['chest1.mp3', 'chest2.mp3', 'chest3.mp3', 'chest4.mp3']

export function getRandomChestMessage(): string {
  const fileName = CHEST_VOICELINE_FILES[Math.floor(Math.random() * CHEST_VOICELINE_FILES.length)]
  return getChestMessage(fileName)
}
