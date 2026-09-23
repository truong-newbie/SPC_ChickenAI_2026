/**
 * FileBridge Sender Engine
 * Based on Floe's sender implementation
 *
 * Handles sending files over WebRTC data channel:
 * - Sends metadata, waits for ack
 * - Sends data chunks with flow control
 * - Supports resume via ack offset
 */

import {
  HIGH_WATER,
  LOW_WATER,
  ACK_TIMEOUT_MS,
  chunkSize,
  metadataMessage,
  endMessage,
  checkCompat,
  compatErrorMessage,
  compatErrorFromIncompatible,
  PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
} from './protocol';

export interface SenderCallbacks {
  onFileStart?: (index: number, total: number, fileName: string) => void;
  onProgress?: (percent: number) => void;
  onSpeed?: (bytesPerSec: number, etaSeconds: number) => void;
  onSpeedReset?: () => void;
  onError?: (msg: string) => void;
  onAllSent?: () => void;
  isDestroyed?: () => boolean;
}

export interface FileEntry {
  id: string;
  file: File;
}

export interface BufferChannel {
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  addEventListener(type: 'bufferedamountlow', handler: () => void): void;
  removeEventListener(type: 'bufferedamountlow', handler: () => void): void;
}

export interface SenderDeps {
  send: (data: string | Uint8Array) => void;
  onData: (handler: (data: string | Uint8Array | ArrayBuffer) => void) => () => void;
  channel: BufferChannel;
  sctpMaxMessageSize?: number | null;
}

const PROGRESS_TICK_MS = 500;
const METADATA_DRAIN_THRESHOLD = 64 * 1024;

interface ProgressView {
  active: boolean;
  size: number;
  offset: number;
  lastSpeedTime: number;
  lastSpeedDelivered: number;
}

export async function sendFiles(
  deps: SenderDeps,
  files: FileEntry[],
  cb: SenderCallbacks = {}
): Promise<void> {
  const destroyed = cb.isDestroyed ?? (() => false);
  const totalBytes = files.reduce((s, e) => s + e.file.size, 0);

  const view: ProgressView = {
    active: false,
    size: 0,
    offset: 0,
    lastSpeedTime: performance.now(),
    lastSpeedDelivered: 0,
  };

  const emitView = () => {
    if (!view.active || destroyed()) return;
    const delivered = Math.min(
      view.size,
      Math.max(0, view.offset - deps.channel.bufferedAmount)
    );
    cb.onProgress?.(
      view.size > 0 ? Math.round((delivered / view.size) * 100) : 100
    );
    const now = performance.now();
    const dt = (now - view.lastSpeedTime) / 1000;
    if (dt >= 1 && delivered > view.lastSpeedDelivered) {
      const bytesPerSec = (delivered - view.lastSpeedDelivered) / dt;
      cb.onSpeed?.(bytesPerSec, (view.size - delivered) / bytesPerSec);
      view.lastSpeedTime = now;
      view.lastSpeedDelivered = delivered;
    }
  };

  const ticker = setInterval(emitView, PROGRESS_TICK_MS);

  try {
    for (let i = 0; i < files.length; i++) {
      if (destroyed()) return;
      const entry = files[i];
      const ok = await sendSingleFile(
        deps,
        entry,
        i + 1,
        files.length,
        totalBytes,
        cb,
        view,
        emitView,
        destroyed
      );
      if (!ok) return;
    }

    if (destroyed()) return;

    await drainBelow(deps.channel, 0, destroyed);
    if (destroyed()) return;

    emitView();
    cb.onSpeedReset?.();
    cb.onAllSent?.();
  } finally {
    clearInterval(ticker);
  }
}

async function sendSingleFile(
  deps: SenderDeps,
  entry: FileEntry,
  index: number,
  total: number,
  _totalBytes: number,
  cb: SenderCallbacks,
  view: ProgressView,
  emitView: () => void,
  destroyed: () => boolean
): Promise<boolean> {
  const { file, id } = entry;
  const { send, onData, channel } = deps;

  if (destroyed()) return true;

  const CHUNK_SIZE = chunkSize(deps.sctpMaxMessageSize);

  // Wait for metadata to drain
  await drainBelow(channel, METADATA_DRAIN_THRESHOLD, destroyed);
  if (destroyed()) return true;

  channel.bufferedAmountLowThreshold = LOW_WATER;

  // Send metadata
  try {
    send(metadataMessage(id, file.name, file.size, index, total));
  } catch {
    return false;
  }

  // Wait for ack
  const ackResult = await waitForAck(onData, id);
  if (ackResult.type === 'timeout') {
    cb.onError?.('Transfer timed out. Receiver not responding. Please try again.');
    return false;
  }
  if (ackResult.type === 'incompatible') {
    cb.onError?.(compatErrorFromIncompatible(ackResult));
    return false;
  }

  // Version check
  if (index === 1 && (ackResult.pv !== undefined || ackResult.pvMin !== undefined)) {
    const { ok, localTooOld } = checkCompat(
      MIN_PROTOCOL_VERSION,
      PROTOCOL_VERSION,
      ackResult.pvMin ?? 0,
      ackResult.pv ?? 0
    );
    if (!ok) {
      cb.onError?.(compatErrorMessage(
        localTooOld,
        '',
        ackResult.ver ?? '',
        MIN_PROTOCOL_VERSION,
        PROTOCOL_VERSION,
        ackResult.pvMin ?? 1,
        ackResult.pv ?? 1
      ));
      return false;
    }
  }

  // Validate resume offset
  const resumeAt: unknown = ackResult.offset;
  if (typeof resumeAt !== 'number' || !Number.isInteger(resumeAt) || resumeAt < 0 || resumeAt > file.size) {
    cb.onError?.(
      `Cannot resume: receiver expects byte ${String(resumeAt)} of ${file.size}`
    );
    return false;
  }

  cb.onFileStart?.(index - 1, total, file.name);
  view.active = true;
  view.size = file.size;
  view.offset = ackResult.offset;
  view.lastSpeedTime = performance.now();
  view.lastSpeedDelivered = ackResult.offset;
  emitView();

  let offset = ackResult.offset;

  // Send file data in chunks
  while (offset < file.size) {
    if (destroyed()) break;

    // Wait for buffer to drain if needed
    if (channel.bufferedAmount >= HIGH_WATER) {
      await waitForBuffer(channel, LOW_WATER, destroyed);
    }

    if (destroyed()) break;

    // Read chunk
    const chunkEnd = Math.min(offset + CHUNK_SIZE, file.size);
    let chunkBuffer: ArrayBuffer;
    try {
      chunkBuffer = await file.slice(offset, chunkEnd).arrayBuffer();
    } catch {
      cb.onError?.(`Could not read file. It may have been moved or deleted.`);
      return false;
    }

    // Send chunk
    try {
      send(new Uint8Array(chunkBuffer));
    } catch {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    offset += chunkBuffer.byteLength;
    view.offset = offset;
  }

  // Send end marker
  try {
    send(endMessage());
  } catch {
    // Ignore
  }

  return true;
}

type AckResult =
  | { type: 'ack'; offset: number; pv?: number; pvMin?: number; ver?: string }
  | { type: 'incompatible'; reason: string; pv?: number; pvMin?: number; ver?: string }
  | { type: 'timeout' };

async function waitForAck(
  onData: (handler: (data: string | Uint8Array | ArrayBuffer) => void) => () => void,
  fileId: string
): Promise<AckResult> {
  let off: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const done = (r: AckResult): AckResult => {
    off?.();
    off = null;
    if (timer) clearTimeout(timer);
    timer = null;
    return r;
  };

  return Promise.race([
    new Promise<AckResult>((resolve) => {
      off = onData((raw) => {
        // Convert to string if needed
        const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        try {
          const msg = JSON.parse(text);
          if (msg.type === 'ack' && msg.id === fileId) {
            resolve({ type: 'ack', offset: msg.offset, pv: msg.pv, pvMin: msg.pvMin, ver: msg.ver });
          } else if (msg.type === 'incompatible') {
            resolve({ type: 'incompatible', reason: msg.reason ?? '', pv: msg.pv, pvMin: msg.pvMin, ver: msg.ver });
          }
        } catch {
          // Not a control message
        }
      });
    }),
    new Promise<AckResult>((resolve) => {
      timer = setTimeout(() => resolve({ type: 'timeout' }), ACK_TIMEOUT_MS);
    }),
  ]).then(done);
}

async function waitForBuffer(
  channel: BufferChannel,
  threshold: number,
  destroyed: () => boolean
): Promise<void> {
  if (channel.bufferedAmount < threshold || destroyed()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (destroyed() || channel.bufferedAmount < threshold) {
        clearInterval(poll);
        resolve();
      }
    }, 200);

    const onLow = () => {
      clearInterval(poll);
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow);
  });
}

async function drainBelow(
  channel: BufferChannel,
  threshold: number,
  destroyed: () => boolean
): Promise<void> {
  if (channel.bufferedAmount <= threshold || destroyed()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (destroyed() || channel.bufferedAmount <= threshold) {
        clearInterval(poll);
        resolve();
      }
    }, 200);

    const onLow = () => {
      clearInterval(poll);
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow);
  });
}
