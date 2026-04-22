import { env } from "@my-better-t-app/env/server"

interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
  speaker: number
  speaker_confidence: number
  punctuated_word: string
}

interface DeepgramUtterance {
  speaker: number
  transcript: string
  start: number
  end: number
  confidence: number
  words: DeepgramWord[]
}

export interface DeepgramResult {
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string
        confidence: number
        words: DeepgramWord[]
      }>
    }>
    utterances: DeepgramUtterance[]
  }
}

export async function transcribeAudio(audioBuffer: Uint8Array | ArrayBuffer): Promise<DeepgramResult> {
  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&utterances=true&smart_format=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
        "Content-Type": "audio/wav",
      },
      body: audioBuffer,
    },
  )

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Deepgram API error (${response.status}): ${errorBody}`)
  }

  return response.json() as Promise<DeepgramResult>
}
