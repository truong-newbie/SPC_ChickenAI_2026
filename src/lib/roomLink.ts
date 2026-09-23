// Room link utilities - Room ID in URL fragment (#), never sent to server

export function generateRoomId(): string {
  // UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function buildShareLink(origin: string, roomId: string): string {
  // Room ID in URL fragment - never sent to server
  return `${origin}#room=${roomId}`;
}

export function getRoomFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash;
  const match = hash.match(/[#&]?room=([^&]+)/);
  return match ? match[1] : null;
}

export function isValidRoomId(roomId: string): boolean {
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(roomId);
}
