const ROOT_DIR = "recordings";

export function isOPFSSupported(): boolean {
  return "storage" in navigator && "getDirectory" in navigator.storage;
}

async function getRecordingDir(recordingId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const recordingsDir = await root.getDirectoryHandle(ROOT_DIR, { create: true });
  return recordingsDir.getDirectoryHandle(recordingId, { create: true });
}

export async function saveChunkToOPFS(
  recordingId: string,
  sequence: number,
  blob: Blob,
): Promise<void> {
  const dir = await getRecordingDir(recordingId);
  const fileHandle = await dir.getFileHandle(`chunk-${sequence}.wav`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function getChunkFromOPFS(
  recordingId: string,
  sequence: number,
): Promise<File | null> {
  try {
    const dir = await getRecordingDir(recordingId);
    const fileHandle = await dir.getFileHandle(`chunk-${sequence}.wav`);
    return fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function listChunksInOPFS(recordingId: string): Promise<number[]> {
  try {
    const dir = await getRecordingDir(recordingId);
    const sequences: number[] = [];
    for await (const [name] of dir.entries()) {
      const match = name.match(/^chunk-(\d+)\.wav$/);
      if (match) {
        sequences.push(Number(match[1]));
      }
    }
    return sequences.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function deleteChunkFromOPFS(recordingId: string, sequence: number): Promise<void> {
  try {
    const dir = await getRecordingDir(recordingId);
    await dir.removeEntry(`chunk-${sequence}.wav`);
  } catch {
    // already deleted or doesn't exist
  }
}

export async function deleteRecordingFromOPFS(recordingId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const recordingsDir = await root.getDirectoryHandle(ROOT_DIR);
    await recordingsDir.removeEntry(recordingId, { recursive: true });
  } catch {
    // already deleted
  }
}

export async function listRecordingsInOPFS(): Promise<string[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const recordingsDir = await root.getDirectoryHandle(ROOT_DIR);
    const ids: string[] = [];
    for await (const [name, handle] of recordingsDir.entries()) {
      if (handle.kind === "directory") {
        ids.push(name);
      }
    }
    return ids;
  } catch {
    return [];
  }
}
