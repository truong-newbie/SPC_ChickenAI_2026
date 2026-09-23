/**
 * FileBridge Transfer Protocol
 * Based on Floe's wire protocol
 *
 * Key design:
 * - Control messages: text frames (JSON)
 * - Data chunks: binary frames
 * - Flow control via bufferedAmountLow event
 */

// Protocol version
export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

// Chunk sizes
export const CONTROL_MSG_MAX = 1000; // bytes
export const HIGH_WATER = 8 * 1024 * 1024; // 8 MB - pause sending
export const LOW_WATER = 4 * 1024 * 1024; // 4 MB - resume sending
export const DEFAULT_CHUNK = 64 * 1024; // 64 KB
export const MAX_CHUNK = 256 * 1024; // 256 KB

// Timeouts
export const ACK_TIMEOUT_MS = 120000; // 2 minutes

// Message types
export type ControlMessageType = 'metadata' | 'ack' | 'end' | 'incompatible';

export interface MetadataMessage {
  type: 'metadata';
  pv: number;
  pvMin: number;
  id: string;
  name: string;
  fileName: string;
  size: number;
  index: number;
  total: number;
}

export interface AckMessage {
  type: 'ack';
  id: string;
  offset: number;
  pv?: number;
  pvMin?: number;
  ver?: string;
}

export interface EndMessage {
  type: 'end';
}

export interface IncompatibleMessage {
  type: 'incompatible';
  reason?: string;
  pv?: number;
  pvMin?: number;
  ver?: string;
}

export type ControlMessage = MetadataMessage | AckMessage | EndMessage | IncompatibleMessage;

// Helper functions
export function isControlFrame(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  try {
    const parsed = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null && 'type' in parsed;
  } catch {
    return false;
  }
}

export function isAbortReason(msg: IncompatibleMessage): boolean {
  return !!msg.reason;
}

export function classifyControl(data: string): ControlMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
      return null;
    }
    return parsed as ControlMessage;
  } catch {
    return null;
  }
}

// Message builders
export function metadataMessage(
  id: string,
  name: string,
  size: number,
  index: number,
  total: number
): string {
  const msg: MetadataMessage = {
    type: 'metadata',
    pv: PROTOCOL_VERSION,
    pvMin: MIN_PROTOCOL_VERSION,
    id,
    name,
    fileName: name,
    size,
    index,
    total,
  };
  return JSON.stringify(msg);
}

export function ackMessage(id: string, offset: number): string {
  const msg: AckMessage = {
    type: 'ack',
    id,
    offset,
    pv: PROTOCOL_VERSION,
    pvMin: MIN_PROTOCOL_VERSION,
  };
  return JSON.stringify(msg);
}

export function endMessage(): string {
  return JSON.stringify({ type: 'end' } as EndMessage);
}

export function incompatibleMessage(reason: string): string {
  const msg: IncompatibleMessage = {
    type: 'incompatible',
    reason,
    pv: PROTOCOL_VERSION,
    pvMin: MIN_PROTOCOL_VERSION,
  };
  return JSON.stringify(msg);
}

export function compatErrorMessage(
  localTooOld: boolean,
  _peerVersion: string,
  _peerVer: string,
  _localMinPv: number,
  _localPv: number,
  peerPvMin: number,
  peerPv: number
): string {
  void _peerVersion; void _peerVer; void _localMinPv; void _localPv;
  if (localTooOld) {
    return `The sender is running an older version of FileBridge that is not compatible with this receiver. Please update the sender.`;
  }
  return `The sender is running a newer version of FileBridge (peer supports pv ${peerPvMin}-${peerPv}) than this receiver supports (pv ${MIN_PROTOCOL_VERSION}-${PROTOCOL_VERSION}).`;
}

export function compatErrorFromIncompatible(msg: IncompatibleMessage): string {
  if (msg.reason) return msg.reason;
  return 'Protocol version mismatch.';
}

// Compatibility check
export function checkCompat(
  localMinPv: number,
  localPv: number,
  peerPvMin: number,
  peerPv: number
): { ok: boolean; localTooOld: boolean } {
  const localTooOld = peerPvMin > localPv;
  const peerTooOld = localMinPv > peerPv;
  const ok = !localTooOld && !peerTooOld;
  return { ok, localTooOld };
}

// Utility
export function normalizeFileSize(size: unknown): number | null {
  if (typeof size === 'number' && Number.isFinite(size) && size >= 0) {
    return Math.floor(size);
  }
  return null;
}

export function chunkSize(sctpMax?: number | null): number {
  if (sctpMax && Number.isFinite(sctpMax) && sctpMax > 0) {
    return Math.min(MAX_CHUNK, sctpMax);
  }
  return DEFAULT_CHUNK;
}

// Generate unique ID for file
export function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Format bytes for display
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Format speed for display
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

// Format ETA
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
