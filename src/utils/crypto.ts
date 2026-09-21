// Crypto utilities using Web Crypto API
// AES-256-GCM for file encryption, ECDH for key exchange

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface EncryptedData {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

// Generate ECDH key pair for key exchange
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey']
  );
  return keyPair;
}

// Export public key as ArrayBuffer for sharing
export async function exportPublicKey(publicKey: CryptoKey): Promise<ArrayBuffer> {
  const exported = await crypto.subtle.exportKey('spki', publicKey);
  return exported;
}

// Import public key from ArrayBuffer
export async function importPublicKey(keyData: ArrayBuffer): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'spki',
    keyData,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    []
  );
}

// Derive shared secret using ECDH
export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  return await crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: peerPublicKey
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt data using AES-256-GCM
export async function encryptData(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    data
  );
  return { ciphertext, iv };
}

// Decrypt data using AES-256-GCM
export async function decryptData(
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<ArrayBuffer> {
  return await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: encryptedData.iv as BufferSource
    },
    key,
    encryptedData.ciphertext
  );
}

// Generate HMAC for integrity check
export async function generateHMAC(data: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.exportKey('raw', key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', hmacKey, data);
}

// Verify HMAC for integrity
export async function verifyHMAC(
  data: ArrayBuffer,
  mac: ArrayBuffer,
  key: CryptoKey
): Promise<boolean> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.exportKey('raw', key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return await crypto.subtle.verify('HMAC', hmacKey, mac, data);
}
