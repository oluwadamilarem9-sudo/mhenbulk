import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const raw = process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "EMAIL_ACCOUNT_ENCRYPTION_KEY is required to store OAuth credentials.",
    );
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      "EMAIL_ACCOUNT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    );
  }

  return key;
}

/**
 * Encrypts a secret with AES-256-GCM.
 * Output format: base64(iv || authTag || ciphertext)
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  const buffer = Buffer.from(payload, "base64");

  if (buffer.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted payload.");
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/** Generate a random 32-byte key suitable for EMAIL_ACCOUNT_ENCRYPTION_KEY. */
export function generateEncryptionKeyBase64(): string {
  return randomBytes(32).toString("base64");
}
