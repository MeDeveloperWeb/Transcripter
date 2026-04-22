import { env } from "@my-better-t-app/env/web";

const BASE = env.NEXT_PUBLIC_SERVER_URL;

export async function createRecording(): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/recordings`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to create recording: ${res.status}`);
  }
  return res.json();
}

export async function uploadChunk(
  recordingId: string,
  sequence: number,
  blob: Blob,
  duration: number,
): Promise<{ chunkId: string; status: string }> {
  const formData = new FormData();
  formData.append("audio", blob, `chunk-${sequence}.wav`);
  formData.append("sequence", String(sequence));
  formData.append("duration", String(duration));

  const res = await fetch(`${BASE}/api/chunks/${recordingId}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Failed to upload chunk: ${res.status}`);
  }
  return res.json();
}

export async function completeRecording(recordingId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/recordings/${recordingId}/complete`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to complete recording: ${res.status}`);
  }
}

export async function reconcileRecording(
  recordingId: string,
  clientSequences: number[],
): Promise<{ missing: number[]; total: number; healthy: number }> {
  const res = await fetch(`${BASE}/api/reconcile/${recordingId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientSequences }),
  });
  if (!res.ok) {
    throw new Error(`Failed to reconcile: ${res.status}`);
  }
  return res.json();
}

export async function triggerTranscription(recordingId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/transcripts/${recordingId}/transcribe`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to trigger transcription: ${res.status}`);
  }
}

export interface RecordingSummary {
  id: string;
  status: string;
  duration: number;
  createdAt: string;
  _count: { chunks: number };
}

export async function listRecordings(): Promise<RecordingSummary[]> {
  const res = await fetch(`${BASE}/api/recordings`);
  if (!res.ok) {
    throw new Error(`Failed to list recordings: ${res.status}`);
  }
  return res.json();
}

export interface ChunkMeta {
  id: string;
  sequence: number;
  status: string;
  duration: number;
  size: number;
}

export async function fetchChunkList(recordingId: string): Promise<ChunkMeta[]> {
  const res = await fetch(`${BASE}/api/chunks/${recordingId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch chunk list: ${res.status}`);
  }
  return res.json();
}

export async function downloadChunk(recordingId: string, sequence: number): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE}/api/chunks/${recordingId}/${sequence}/download`);
  if (!res.ok) {
    throw new Error(`Failed to download chunk ${sequence}: ${res.status}`);
  }
  return res.arrayBuffer();
}

export interface TranscriptData {
  id: string;
  text: string;
  utterances: Array<{
    speaker: number;
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  status: string;
  error: string | null;
}

export async function getTranscripts(
  recordingId: string,
): Promise<{ recordingId: string; transcript: TranscriptData | null }> {
  const res = await fetch(`${BASE}/api/transcripts/${recordingId}`);
  if (!res.ok) {
    throw new Error(`Failed to get transcripts: ${res.status}`);
  }
  return res.json();
}
