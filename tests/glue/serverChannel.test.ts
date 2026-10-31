import { describe, expect, it } from "vitest";
import { type ChannelSocket, startServerChannel } from "../../src/glue/serverChannel";

class FakeSocket implements ChannelSocket {
  sent: unknown[] = [];
  closed = false;
  onopen: ChannelSocket["onopen"] = null;
  onmessage: ChannelSocket["onmessage"] = null;
  onclose: ChannelSocket["onclose"] = null;
  onerror: ChannelSocket["onerror"] = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const withMarker = (content = "/__noneuclid/channel") => ({
  querySelector: () => ({ getAttribute: () => content }) as unknown as Element,
});
const withoutMarker = { querySelector: () => null };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(api: Record<string, unknown>) {
  const sockets: FakeSocket[] = [];
  const timers: { callback: () => void; delayMs: number }[] = [];
  const channel = startServerChannel({
    api,
    document: withMarker(),
    location: { protocol: "https:", host: "192.168.1.50:11446" },
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimer: (callback, delayMs) => timers.push({ callback, delayMs }),
  });
  return { channel, sockets, timers };
}

describe("startServerChannel", () => {
  it("does not connect without the server marker", () => {
    const sockets: FakeSocket[] = [];
    const channel = startServerChannel({
      api: {},
      document: withoutMarker,
      location: { protocol: "http:", host: "x" },
      socketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    expect(channel.enabled).toBe(false);
    expect(sockets).toHaveLength(0);
  });

  it("connects to the marker's path on the page's host, with wss for https", () => {
    const { sockets } = setup({});
    expect(sockets[0].url).toBe("wss://192.168.1.50:11446/__noneuclid/channel");
  });

  it("says hello with the app info", async () => {
    const { sockets } = setup({ app: { info: () => ({ worldId: "cube" }) } });
    sockets[0].onopen?.({});
    await tick();
    expect(sockets[0].sent).toEqual([{ type: "hello", role: "device", info: { worldId: "cube" } }]);
  });

  it("answers call, list and eval", async () => {
    const { sockets } = setup({ app: { add: (a: number, b: number) => a + b } });
    const socket = sockets[0];
    socket.receive({ id: 1, type: "call", path: ["app", "add"], args: [2, 3] });
    socket.receive({ id: 2, type: "list" });
    socket.receive({ id: 3, type: "eval", expression: "1 + 1" });
    socket.receive({ id: 4, type: "call", path: ["app", "nope"], args: [] });
    await tick();
    expect(socket.sent).toContainEqual({ id: 1, ok: true, value: 5 });
    expect(socket.sent).toContainEqual({ id: 2, ok: true, value: { app: ["add"] } });
    expect(socket.sent).toContainEqual({ id: 3, ok: true, value: 2 });
    expect(socket.sent).toContainEqual({ id: 4, ok: false, error: "no such API function: app.nope" });
  });

  it("forwards console output only while turned on", async () => {
    const { sockets } = setup({});
    const socket = sockets[0];
    const original = console.info;
    socket.receive({ id: 1, type: "console", on: true });
    await tick();
    console.info("hello", { a: 1 });
    socket.receive({ id: 2, type: "console", on: false });
    await tick();
    console.info("after");
    expect(console.info).toBe(original);
    expect(socket.sent).toContainEqual({ type: "console", level: "info", text: 'hello {"a":1}' });
    expect(socket.sent.filter((m) => (m as { type?: string }).type === "console")).toHaveLength(1);
  });

  it("reconnects with a delay that doubles and caps at 30 s", () => {
    const { sockets, timers } = setup({});
    for (let index = 0; index < 8; index += 1) {
      sockets[index].onclose?.({});
      expect(sockets).toHaveLength(index + 1);
      timers[index].callback();
      expect(sockets).toHaveLength(index + 2);
    }
    expect(timers.map((timer) => timer.delayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("resets the delay after a successful connection and stops after close", () => {
    const { channel, sockets, timers } = setup({});
    sockets[0].onclose?.({});
    timers[0].callback();
    sockets[1].onopen?.({});
    sockets[1].onclose?.({});
    expect(timers[1].delayMs).toBe(1000);
    channel.close();
    timers[1].callback();
    expect(sockets).toHaveLength(2);
  });
});
