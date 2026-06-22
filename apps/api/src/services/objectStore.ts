import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectStore {
  put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }>;
  get(id: string): Promise<StoredObject | undefined>;
}

export interface ObjectStoreOptions {
  publicBaseUrl?: string;
  idGenerator?: () => string;
}

export const DEFAULT_PUBLIC_BASE_URL = "http://localhost:8787";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

function extensionForContentType(contentType: string): string {
  return EXT_BY_TYPE[contentType] ?? "bin";
}

function contentTypeForId(id: string): string {
  const ext = id.split(".").pop() ?? "";
  return TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

function buildId(idGenerator: () => string, contentType: string): string {
  return `${idGenerator()}.${extensionForContentType(contentType)}`;
}

function buildUrl(publicBaseUrl: string, id: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/files/${id}`;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, StoredObject>();
  private readonly publicBaseUrl: string;
  private readonly idGenerator: () => string;

  constructor(options: ObjectStoreOptions = {}) {
    this.publicBaseUrl = options.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL;
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }> {
    const id = buildId(this.idGenerator, contentType);
    this.objects.set(id, { bytes: Uint8Array.from(bytes), contentType });
    return { id, url: buildUrl(this.publicBaseUrl, id) };
  }

  async get(id: string): Promise<StoredObject | undefined> {
    const object = this.objects.get(id);
    return object ? { bytes: Uint8Array.from(object.bytes), contentType: object.contentType } : undefined;
  }
}

export class LocalFileObjectStore implements ObjectStore {
  private readonly publicBaseUrl: string;
  private readonly idGenerator: () => string;

  constructor(
    private readonly dir: string,
    options: ObjectStoreOptions = {}
  ) {
    this.publicBaseUrl = options.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL;
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }> {
    const id = buildId(this.idGenerator, contentType);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, id), bytes);
    return { id, url: buildUrl(this.publicBaseUrl, id) };
  }

  async get(id: string): Promise<StoredObject | undefined> {
    try {
      const bytes = await readFile(join(this.dir, id));
      return { bytes: new Uint8Array(bytes), contentType: contentTypeForId(id) };
    } catch {
      return undefined;
    }
  }
}
