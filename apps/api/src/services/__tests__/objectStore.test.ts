import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryObjectStore, LocalFileObjectStore } from "../objectStore";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("InMemoryObjectStore", () => {
  it("stores bytes and serves them at a files URL", async () => {
    let n = 0;
    const store = new InMemoryObjectStore({ publicBaseUrl: "https://api.test", idGenerator: () => `id${(n += 1)}` });

    const { id, url } = await store.put(bytes("hello"), "image/png");

    expect(id).toBe("id1.png");
    expect(url).toBe("https://api.test/files/id1.png");
    const got = await store.get(id);
    expect(got?.contentType).toBe("image/png");
    expect(new TextDecoder().decode(got!.bytes)).toBe("hello");
  });

  it("maps content types to extensions", async () => {
    let n = 0;
    const store = new InMemoryObjectStore({ idGenerator: () => `id${(n += 1)}` });
    expect((await store.put(bytes("a"), "image/jpeg")).id).toBe("id1.jpg");
    expect((await store.put(bytes("b"), "image/webp")).id).toBe("id2.webp");
    expect((await store.put(bytes("c"), "application/x-other")).id).toBe("id3.bin");
  });

  it("returns undefined for an unknown id", async () => {
    const store = new InMemoryObjectStore();
    expect(await store.get("missing.png")).toBeUndefined();
  });

  it("does not share mutable references with stored bytes", async () => {
    const store = new InMemoryObjectStore({ idGenerator: () => "x" });
    const input = bytes("hello");
    const { id } = await store.put(input, "image/png");
    input[0] = 0;
    const got = await store.get(id);
    expect(new TextDecoder().decode(got!.bytes)).toBe("hello");
  });
});

describe("LocalFileObjectStore", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips bytes through the filesystem", async () => {
    dir = await mkdtemp(join(tmpdir(), "objstore-"));
    let n = 0;
    const store = new LocalFileObjectStore(dir, { publicBaseUrl: "https://api.test", idGenerator: () => `id${(n += 1)}` });

    const { id, url } = await store.put(bytes("pixels"), "image/png");

    expect(url).toBe("https://api.test/files/id1.png");
    const got = await store.get(id);
    expect(got?.contentType).toBe("image/png");
    expect(new TextDecoder().decode(got!.bytes)).toBe("pixels");
    expect(await store.get("missing.png")).toBeUndefined();
  });

  it("rejects path-traversal ids without touching the filesystem", async () => {
    dir = await mkdtemp(join(tmpdir(), "objstore-"));
    const store = new LocalFileObjectStore(dir);

    expect(await store.get("../../etc/passwd")).toBeUndefined();
    expect(await store.get("../secret.png")).toBeUndefined();
    expect(await store.get("a/b.png")).toBeUndefined();
  });
});
