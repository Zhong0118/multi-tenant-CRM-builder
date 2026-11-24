import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { ApiException } from '../../../common/errors/api.exception';

export interface Envelope {
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

const unavailable = () =>
  new ApiException('AI_PROVIDER_UNAVAILABLE', 503, {
    message: '无法使用模型主密钥，请检查部署密钥环。',
  });

export class ModelKeyring {
  private keys = new Map<string, Buffer>();
  readonly activeKeyId: string;

  constructor(raw?: string) {
    try {
      const data = JSON.parse(raw ?? '') as {
        activeKeyId: string;
        keys: Record<string, string>;
      };
      for (const [id, encoded] of Object.entries(data.keys)) {
        const key = Buffer.from(encoded, 'base64');
        if (
          !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
          key.length !== 32 ||
          key.toString('base64') !== encoded
        )
          throw unavailable();
        this.keys.set(id, key);
      }
      if (!this.keys.has(data.activeKeyId)) throw unavailable();
      this.activeKeyId = data.activeKeyId;
    } catch {
      throw unavailable();
    }
  }

  // The database receives only a domain-specific capability. The master keys
  // never leave the API process. Its verifier is stored beside each envelope.
  proofs(): string[] {
    return [...this.keys.values()].map((key) =>
      createHmac('sha256', key)
        .update('crm/model-envelope/read/v1')
        .digest('hex'),
    );
  }
  verifier(): string {
    const proof = createHmac('sha256', this.keys.get(this.activeKeyId)!)
      .update('crm/model-envelope/read/v1')
      .digest('hex');
    return createHash('sha256').update(proof).digest('hex');
  }

  seal(providerId: string, credentialId: string, secret: string): Envelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.activeKeyId)!,
      nonce,
    );
    cipher.setAAD(Buffer.from(JSON.stringify([providerId, credentialId])));
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return {
      keyId: this.activeKeyId,
      nonce: nonce.toString('base64'),
      ciphertext: encrypted.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  open(providerId: string, credentialId: string, envelope: Envelope): string {
    try {
      const cipher = createDecipheriv(
        'aes-256-gcm',
        this.keys.get(envelope.keyId)!,
        Buffer.from(envelope.nonce, 'base64'),
      );
      cipher.setAAD(Buffer.from(JSON.stringify([providerId, credentialId])));
      cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return Buffer.concat([
        cipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        cipher.final(),
      ]).toString('utf8');
    } catch {
      throw unavailable();
    }
  }
}
