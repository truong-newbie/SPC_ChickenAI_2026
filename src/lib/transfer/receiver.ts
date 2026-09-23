/**
 * FileBridge Receiver Engine
 * Based on Floe's receiver implementation
 *
 * Handles receiving files over WebRTC data channel:
 * - Receives metadata, sends ack
 * - Accumulates chunks
 * - Validates size on completion
 * - Assembles files
 */

import {
  classifyControl,
  isControlFrame,
  CONTROL_MSG_MAX,
  ackMessage,
  incompatibleMessage,
  checkCompat,
  PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  normalizeFileSize,
  type MetadataMessage,
  type IncompatibleMessage,
} from './protocol';

export interface ReceivedFile {
  id: string;
  fileName: string;
  fileSize: number;
  blob: Blob;
}

export interface ReceiverCallbacks {
  send: (data: string | Uint8Array) => void;
  onFileStart?: (index: number, total: number, fileName: string, fileSize: number) => void;
  onProgress?: (percent: number, received: number, fileSize: number) => void;
  onSpeed?: (bytesPerSec: number, etaSeconds: number) => void;
  onSpeedReset?: () => void;
  onFileComplete?: (file: ReceivedFile, index: number, total: number) => void;
  onAllComplete?: (totalBytes: number, fileCount: number) => void;
  onWaiting?: () => void;
  onError?: (msg: string) => void;
}

const PROGRESS_STEP = 1024 * 1024; // Report every 1 MB

interface PartialDownload {
  chunks: ArrayBuffer[];
  received: number;
  lastReported: number;
}

export function createReceiver(cb: ReceiverCallbacks): { handleMessage: (data: string | Uint8Array | ArrayBuffer) => void } {
  const partialDownloads = new Map<string, PartialDownload>();
  let currentMetadata: MetadataMessage | null = null;
  let hasCheckedCompat = false;
  let aborted = false;
  let expectedSize: number | null = null;
  let sessionBytes = 0;

  let receiveSpeedStart = performance.now();
  let receiveSpeedBytes = 0;
  let lastReceiveSpeedUpdate = 0;

  function handleMessage(data: string | Uint8Array | ArrayBuffer): void {
    if (aborted) return;

    // Control message (text frame)
    if (isControlFrame(data)) {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);

      // Check size limit
      const encoded = new TextEncoder().encode(text);
      if (encoded.byteLength > CONTROL_MSG_MAX) {
        aborted = true;
        partialDownloads.clear();
        currentMetadata = null;
        expectedSize = null;
        cb.onError?.('Control message too large. Transfer stopped.');
        return;
      }

      const msg = classifyControl(text);
      if (!msg) return;

      // Version check on first metadata
      if (msg.type === 'metadata') {
        if (!hasCheckedCompat) {
          hasCheckedCompat = true;
          const remotePv = (msg as MetadataMessage).pv ?? 0;
          const remotePvMin = (msg as MetadataMessage).pvMin ?? 0;
          const { ok } = checkCompat(
            MIN_PROTOCOL_VERSION,
            PROTOCOL_VERSION,
            remotePvMin,
            remotePv
          );
          if (!ok) {
            aborted = true;
            cb.onError?.(`Protocol version mismatch. Local: ${MIN_PROTOCOL_VERSION}-${PROTOCOL_VERSION}, Remote: ${remotePvMin}-${remotePv}`);
            // Send incompatible message
            try {
              const enc = new TextEncoder().encode(incompatibleMessage('Protocol version mismatch'));
              cb.send(new Uint8Array(enc));
            } catch {
              // Peer is gone
            }
            return;
          }
        }

        currentMetadata = msg as MetadataMessage;
        expectedSize = normalizeFileSize((msg as MetadataMessage).size);
        receiveSpeedStart = performance.now();
        receiveSpeedBytes = 0;
        lastReceiveSpeedUpdate = 0;
        cb.onSpeedReset?.();

        const m = msg as MetadataMessage;
        cb.onFileStart?.(m.index, m.total, m.name, expectedSize ?? 0);

        // Check for resume
        let offset = 0;
        const existing = partialDownloads.get(m.id);
        if (existing) {
          offset = existing.received;
        } else {
          partialDownloads.set(m.id, { chunks: [], received: 0, lastReported: 0 });
        }

        // Send ack with offset
        cb.send(ackMessage(m.id, offset));
      } else if (msg.type === 'ack') {
        // Sender received our ack - not used in receiver
      } else if (msg.type === 'incompatible') {
        aborted = true;
        partialDownloads.clear();
        currentMetadata = null;
        expectedSize = null;
        const incompat = msg as IncompatibleMessage;
        cb.onError?.(incompat.reason ?? 'Sender stopped the transfer.');
        return;
      } else if (msg.type === 'end') {
        if (!currentMetadata) return;
        const fileData = partialDownloads.get(currentMetadata.id);
        if (!fileData) return;

        // Validate size
        if (expectedSize !== null && fileData.received !== expectedSize) {
          const got = fileData.received;
          const want = expectedSize;
          partialDownloads.delete(currentMetadata.id);
          currentMetadata = null;
          expectedSize = null;
          aborted = true;
          cb.onProgress?.(0, 0, 0);
          cb.onSpeedReset?.();
          try {
            const enc = new TextEncoder().encode(incompatibleMessage(`Incomplete file: got ${got}, expected ${want}`));
            cb.send(new Uint8Array(enc));
          } catch {
            // Peer is gone
          }
          cb.onError?.(
            got < want
              ? `File incomplete: received ${got} of ${want} bytes. Transfer was cut short.`
              : `File too large: received ${got} bytes, expected ${want}.`
          );
          return;
        }

        // Assemble file
        const blob = new Blob(fileData.chunks);
        const completed: ReceivedFile = {
          id: currentMetadata.id,
          fileName: currentMetadata.name,
          fileSize: fileData.received,
          blob,
        };

        partialDownloads.delete(currentMetadata.id);
        cb.onFileComplete?.(completed, currentMetadata.index, currentMetadata.total);

        sessionBytes += fileData.received;
        if (currentMetadata.index === currentMetadata.total) {
          cb.onAllComplete?.(sessionBytes, currentMetadata.total);
          sessionBytes = 0;
        }

        currentMetadata = null;
        expectedSize = null;
        cb.onWaiting?.();
        cb.onProgress?.(0, 0, 0);
        cb.onSpeedReset?.();
      }
      return;
    }

    // Binary data chunk
    let buf: Uint8Array;
    if (data instanceof Uint8Array) {
      buf = data;
    } else if (data instanceof ArrayBuffer) {
      buf = new Uint8Array(data);
    } else {
      // String - ignore
      return;
    }
    if (!currentMetadata) return;
    const fileData = partialDownloads.get(currentMetadata.id);
    if (!fileData) return;

    // Copy to new ArrayBuffer to avoid SharedArrayBuffer issues
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    fileData.chunks.push(arrayBuffer);
    fileData.received += buf.byteLength;
    receiveSpeedBytes += buf.byteLength;

    // Calculate speed
    const now = performance.now();
    if (now - lastReceiveSpeedUpdate > 1000) {
      const elapsed = (now - receiveSpeedStart) / 1000;
      if (elapsed > 0 && expectedSize) {
        const bytesPerSec = receiveSpeedBytes / elapsed;
        const remaining = expectedSize - fileData.received;
        cb.onSpeed?.(bytesPerSec, remaining / bytesPerSec);
      }
      receiveSpeedStart = now;
      receiveSpeedBytes = 0;
      lastReceiveSpeedUpdate = now;
    }

    // Report progress
    if (
      expectedSize &&
      (fileData.received - fileData.lastReported >= PROGRESS_STEP ||
        fileData.received === expectedSize)
    ) {
      fileData.lastReported = fileData.received;
      cb.onProgress?.(
        Math.round((fileData.received / expectedSize) * 100),
        fileData.received,
        expectedSize
      );
    }
  }

  return { handleMessage };
}
