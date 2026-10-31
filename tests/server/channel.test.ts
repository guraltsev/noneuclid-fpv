import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

// Plain ESM script; load through a variable path so tsc does not need declarations.
const modulePath = "../../scripts/server/localServer.mjs";

interface Started {
  port: number;
  close(): Promise<void>;
}
interface LocalServerModule {
  startLocalServer(o: Record<string, unknown>): Promise<Started>;
}
const load = async () => (await import(/* @vite-ignore */ modulePath)) as LocalServerModule;

type Message = Record<string, unknown>;

/** A WebSocket client that queues incoming messages so tests can await the next one matching a predicate. */
class Client {
  readonly ws: WebSocket;
  readonly received: Message[] = [];
  private waiters: { test: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
  closed = false;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/__noneuclid/channel`);
    this.ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Message;
      this.received.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (w.test(message)) {
          w.resolve(message);
          return false;
        }
        return true;
      });
    });
    this.ws.on("close", () => (this.closed = true));
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(message: Message): void {
    this.ws.send(JSON.stringify(message));
  }

  next(test: (m: Message) => boolean): Promise<Message> {
    const found = this.received.find(test);
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => this.waiters.push({ test, resolve }));
  }

  waitClosed(): Promise<void> {
    return new Promise((resolve) => (this.closed ? resolve() : this.ws.once("close", () => resolve())));
  }
}

/** A fake device: answers `call` with the path joined, `eval` with the expression, and records every request. */
async function connectDevice(port: number, info: Message = {}): Promise<{ client: Client; requests: Message[]; id: string }> {
  const client = new Client(port);
  await client.open();
  const requests: Message[] = [];
  client.ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as Message;
    if (message.type === "call") {
      requests.push(message);
      client.send({ id: message.id, ok: true, value: (message.path as string[]).join(".") });
    } else if (message.type === "eval") {
      requests.push(message);
      client.send({ id: message.id, ok: true, value: message.expression });
    } else if (message.type === "console") {
      requests.push(message);
      client.send({ id: message.id, ok: true, value: null });
    }
  });
  client.send({ type: "hello", role: "device", info });
  const hello = await client.next((m) => m.type === "hello");
  return { client, requests, id: hello.id as string };
}

async function connectAdmin(port: number, password: string): Promise<Client> {
  const client = new Client(port);
  await client.open();
  client.send({ type: "hello", role: "admin", password });
  return client;
}

describe("server channel", () => {
  let root: string;
  let servers: Started[];
  const clients: Client[] = [];

  async function start(options: Record<string, unknown> = {}): Promise<Started> {
    const { startLocalServer } = await load();
    const server = await startLocalServer({
      dist: root,
      host: "127.0.0.1",
      port: 0,
      adminPassword: "secret",
      callTimeoutMs: 2000,
      ...options,
    });
    servers.push(server);
    return server;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "channel-server-"));
    fs.writeFileSync(path.join(root, "index.html"), "<html><head></head></html>");
    servers = [];
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.ws.terminate();
    for (const server of servers) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const track = <T extends Client>(client: T): T => {
    clients.push(client);
    return client;
  };

  it("rejects an admin with a wrong password (after a delay) and closes", async () => {
    const server = await start();
    const admin = track(await connectAdmin(server.port, "wrong"));
    const started = Date.now();
    const reply = await admin.next((m) => m.type === "hello");
    expect(reply.ok).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    await admin.waitClosed();
  });

  it("refuses admins when no password is configured", async () => {
    const server = await start({ adminPassword: undefined });
    const admin = track(await connectAdmin(server.port, "anything"));
    const reply = await admin.next((m) => m.type === "hello");
    expect(reply.ok).toBe(false);
    expect(String(reply.error)).toContain("NONEUCLID_ADMIN_PASSWORD");
  });

  it("does not answer admin requests before a successful hello", async () => {
    const server = await start();
    const client = track(new Client(server.port));
    await client.open();
    client.send({ id: 1, type: "devices" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(client.received).toEqual([]);
  });

  it("lists connected devices with ids in connection order", async () => {
    const server = await start();
    const first = await connectDevice(server.port, { worldId: "cube" });
    const second = await connectDevice(server.port, { worldId: "torus" });
    track(first.client);
    track(second.client);
    expect([first.id, second.id]).toEqual(["d1", "d2"]);
    const admin = track(await connectAdmin(server.port, "secret"));
    expect((await admin.next((m) => m.type === "hello")).ok).toBe(true);
    admin.send({ id: 1, type: "devices" });
    const reply = await admin.next((m) => m.id === 1);
    const list = reply.value as { id: string; info: Message }[];
    expect(list.map((d) => [d.id, d.info.worldId])).toEqual([["d1", "cube"], ["d2", "torus"]]);
  });

  it("routes a call to one device and to all devices", async () => {
    const server = await start();
    const first = await connectDevice(server.port);
    const second = await connectDevice(server.port);
    track(first.client);
    track(second.client);
    const admin = track(await connectAdmin(server.port, "secret"));
    await admin.next((m) => m.type === "hello");

    admin.send({ id: 1, type: "call", target: "d2", path: ["app", "info"], args: [] });
    expect(await admin.next((m) => m.id === 1)).toEqual({ id: 1, ok: true, value: "app.info" });
    expect(first.requests).toHaveLength(0);
    expect(second.requests).toHaveLength(1);

    admin.send({ id: 2, type: "call", target: "all", path: ["app", "reload"], args: [] });
    expect(await admin.next((m) => m.id === 2)).toEqual({
      id: 2,
      ok: true,
      value: { d1: { ok: true, value: "app.reload" }, d2: { ok: true, value: "app.reload" } },
    });

    admin.send({ id: 3, type: "call", target: "d9", path: ["a"], args: [] });
    expect((await admin.next((m) => m.id === 3)).ok).toBe(false);
  });

  it("refuses eval without dev mode and allows it with dev mode", async () => {
    const plain = await start();
    const device = await connectDevice(plain.port);
    track(device.client);
    const admin = track(await connectAdmin(plain.port, "secret"));
    await admin.next((m) => m.type === "hello");
    admin.send({ id: 1, type: "eval", target: "d1", expression: "1+1" });
    const refused = await admin.next((m) => m.id === 1);
    expect(refused.ok).toBe(false);
    expect(device.requests).toHaveLength(0);

    const dev = await start({ dev: true });
    const devDevice = await connectDevice(dev.port);
    track(devDevice.client);
    const devAdmin = track(await connectAdmin(dev.port, "secret"));
    await devAdmin.next((m) => m.type === "hello");
    devAdmin.send({ id: 1, type: "eval", target: "d1", expression: "1+1" });
    expect(await devAdmin.next((m) => m.id === 1)).toEqual({ id: 1, ok: true, value: "1+1" });
  });

  it("relays console output only while forwarding is on", async () => {
    const server = await start();
    const device = await connectDevice(server.port);
    track(device.client);
    const admin = track(await connectAdmin(server.port, "secret"));
    await admin.next((m) => m.type === "hello");

    device.client.send({ type: "console", level: "log", text: "before" });
    admin.send({ id: 1, type: "console", target: "d1", on: true });
    await admin.next((m) => m.id === 1);
    expect(device.requests.at(-1)).toMatchObject({ type: "console", on: true });
    device.client.send({ type: "console", level: "warn", text: "during" });
    expect(await admin.next((m) => m.type === "console")).toEqual({
      type: "console",
      device: "d1",
      level: "warn",
      text: "during",
    });

    admin.send({ id: 2, type: "console", target: "d1", on: false });
    await admin.next((m) => m.id === 2);
    expect(device.requests.at(-1)).toMatchObject({ type: "console", on: false });
    device.client.send({ type: "console", level: "log", text: "after" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(admin.received.filter((m) => m.type === "console").map((m) => m.text)).toEqual(["during"]);
  });
});
