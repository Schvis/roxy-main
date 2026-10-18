# Hands-free Voice (fork)

Fork additions on top of upstream's local streaming voice
([voice-transcription.md](voice-transcription.md)). Upstream's engine is the only
speech-to-text path; the former faster-whisper/Python one was removed. The
settings appear as a **Hands-free** block inside upstream's Voice Translation
panel ([`VoiceHandsFree.tsx`](../src/renderer/src/components/VoiceHandsFree.tsx)),
so `VoiceSettings.tsx` and the Settings navigation stay as upstream ships them.

## Settings

Stored in upstream's `voice` row as extra `VoiceSettings` fields:

- `holdKey` (default `Alt+V`): in-window hold-to-talk. Works in the main window and
  the overlay, not while Roxy is unfocused. Upstream's two global hotkeys remain
  toggle-only.
- `autoSend`: submit the draft when a dictation finishes with text. With it on, a
  mic click (and every wake-word dictation) auto-stops: an energy gate ends the
  recording after 1.5 s of silence following speech, or after 8 s of none.
- `wakeWord` / `wakeWords`: keep the microphone open in the main window and start
  dictating on a wake phrase (built-in "Hey Roxy" variants plus custom phrases).

Until the `voice` row is first saved, these are read from the removed
faster-whisper keys (`voice_keybind`, `voice_auto_send`, `voice_wake_word`,
`voice_wake_words`). Voice itself stays off, since it needs a model.

## Listeners

`voice.listen` / `voice.unlisten` are the exception to upstream's on-demand capture.
The wake word (main window) and the VTuber voice conversation keep the microphone
open. An adaptive energy gate with 300 ms pre-roll feeds the recognizer only during
speech and finishes an utterance after 700 ms of silence (15 s max); each
utterance goes back to its window as text. Only the newest listener holds the mic,
dictation preempts all of them, and they release it while suspended or locked.

Wake phrases are matched in the renderer (`matchWakeWord` in `src/shared/voice-handsfree.ts`):
a phrase followed by a request fills the draft, a bare phrase starts an
auto-stopping dictation. The VTuber conversation submits each utterance and gives
the microphone back while Roxy thinks or speaks.

Recording events go to the window that started the recording, so the overlay can
dictate too; upstream binds voice to the main window only.

## Where the code lives

Upstream's voice files carry only small hook lines marked `fork`:

| Upstream file                   | Fork module                                      | Hooks                                                                                                  |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `src/shared/voice.ts`           | `src/shared/voice-handsfree.ts`                  | `VoiceSettings extends HandsFreeSettings`, `normalizeHandsFree` spread, `HandsFreeEvent` union         |
| `src/main/services/voice.ts`    | `src/main/services/voice-handsfree.ts`           | `createHandsFree(host)`; `route`, `onWorkerMessage`, `onWorkerExit`, `autoStop`, `dictate`, `register` |
| `src/renderer/src/lib/voice.ts` | `src/renderer/src/lib/voice-handsfree.ts`        | `useVoiceComposer(…, extension)`: `routes`, `startOptions`, `onStopped`                                |
| `VoiceSettings.tsx`             | `src/renderer/src/components/VoiceHandsFree.tsx` | one `<VoiceHandsFree/>` mount                                                                          |

When an upstream merge conflicts in one of these files, take upstream's side and
re-add the marked lines.
