export interface SyncObjectContext {
  readonly vaultId: string;
  readonly kind: 'snapshot' | 'asset';
  readonly objectId: string;
}

export interface SyncKeyMaterial {
  readonly key: CryptoKey;
  readonly recoveryKey: string;
}

export interface SyncCrypto {
  createKey(): Promise<SyncKeyMaterial>;
  importKey(recoveryKey: string): Promise<CryptoKey>;
  encrypt(input: {
    readonly key: CryptoKey;
    readonly context: SyncObjectContext;
    readonly plaintext: Uint8Array;
  }): Promise<Uint8Array>;
  decrypt(input: {
    readonly key: CryptoKey;
    readonly context: SyncObjectContext;
    readonly ciphertext: Uint8Array;
  }): Promise<Uint8Array>;
  hash(bytes: Uint8Array): Promise<string>;
}
