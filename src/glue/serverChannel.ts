/**
 * Page side of the channel to the local server (scripts/server/localServer.mjs): a WebSocket over which an admin can call any function of this page's public API (src/runtime/apiCall.ts), list it, evaluate expressions (dev mode only) and read forwarded console output.
 * The channel starts only when the page carries `<meta name="noneuclid-server" content="/__noneuclid/channel">`, which only the local server adds; on GitHub Pages, the Vite dev server and the smoke server nothing happens.
 */
import { type ApiObject, callApi, listApi, toPlainData } from "../runtime/apiCall";

/** The slice of the WebSocket interface the channel uses (so tests can pass a fake). */
export interface ChannelSocket {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Inputs of {@link startServerChannel}; everything but `api` defaults to the browser's own. */
export interface ServerChannelOptions {
  /** The public API object whose functions the server may call. */
  readonly api: ApiObject;
  /** Creates the socket for a URL; default `url => new WebSocket(url)`. */
  readonly socketFactory?: (url: string) => ChannelSocket;
  /** The page location, used for protocol and host. */
  readonly location?: Pick<Location, "protocol" | "host">;
  /** The document searched for the server marker. */
  readonly document?: Pick<Document, "querySelector">;
  /** Timer used for reconnect delays; default `setTimeout`. */
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
}

/** Handle returned by {@link startServerChannel}. */
export interface ServerChannel {
  /** True when the page carries the server marker. */
  readonly enabled: boolean;
  /** Stops reconnecting and closes the socket. */
  close(): void;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_CONSOLE_TEXT_LENGTH = 2000;
const CONSOLE_LEVELS = ["log", "info", "warn", "error"] as const;

/** Connects to the local server when the page was served by it, and answers its requests; returns a handle to stop it. */
export function startServerChannel(options: ServerChannelOptions): ServerChannel {
  const doc = options.document ?? (typeof document === "undefined" ? undefined : document);
  const marker = doc?.querySelector<HTMLMetaElement>('meta[name="noneuclid-server"]');
  const path = marker?.getAttribute("content");
  if (!doc || !path) {
    return { enabled: false, close() {} };
  }
  const pageLocation = options.location ?? window.location;
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as ChannelSocket);
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const url = `${pageLocation.protocol === "https:" ? "wss:" : "ws:"}//${pageLocation.host}${path}`;

  let socket: ChannelSocket | undefined;
  let closed = false;
  let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  let restoreConsole: (() => void) | undefined;

  const connect = (): void => {
    if (closed) {
      return;
    }
    const next = socketFactory(url);
    socket = next;
    next.onopen = () => {
      reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      void sendHello(next);
    };
    next.onmessage = (event) => {
      void handleMessage(next, event.data);
    };
    next.onclose = () => {
      stopConsoleForwarding();
      if (socket === next) {
        socket = undefined;
      }
      if (!closed) {
        const delay = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        setTimer(connect, delay);
      }
    };
    next.onerror = () => {
      // The close event that follows triggers the reconnect.
    };
  };

  const sendHello = async (target: ChannelSocket): Promise<void> => {
    let info: unknown = {};
    try {
      info = await callApi(options.api, ["app", "info"], []);
    } catch {
      // A page without api.app still joins.
    }
    target.send(JSON.stringify({ type: "hello", role: "device", info }));
  };

  const handleMessage = async (target: ChannelSocket, data: unknown): Promise<void> => {
    let message: { id?: unknown; type?: unknown; path?: unknown; args?: unknown; expression?: unknown; on?: unknown };
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    const reply = (body: { ok: true; value: unknown } | { ok: false; error: string }): void => {
      target.send(JSON.stringify({ id: message.id, ...body }));
    };
    try {
      if (message.type === "call") {
        const path = Array.isArray(message.path) ? message.path.map(String) : [];
        const args = Array.isArray(message.args) ? message.args : [];
        reply({ ok: true, value: await callApi(options.api, path, args) });
      } else if (message.type === "list") {
        reply({ ok: true, value: listApi(options.api) });
      } else if (message.type === "eval") {
        const value = await (0, eval)(String(message.expression));
        reply({ ok: true, value: toPlainData(value) });
      } else if (message.type === "console") {
        if (message.on === true) {
          startConsoleForwarding(target);
        } else {
          stopConsoleForwarding();
        }
        reply({ ok: true, value: null });
      } else {
        reply({ ok: false, error: `unknown message type: ${String(message.type)}` });
      }
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const startConsoleForwarding = (target: ChannelSocket): void => {
    stopConsoleForwarding();
    const originals = new Map<string, (...args: unknown[]) => void>();
    for (const level of CONSOLE_LEVELS) {
      const original = console[level].bind(console) as (...args: unknown[]) => void;
      originals.set(level, console[level]);
      console[level] = (...args: unknown[]) => {
        original(...args);
        const text = args.map(stringifyConsoleArgument).join(" ").slice(0, MAX_CONSOLE_TEXT_LENGTH);
        try {
          target.send(JSON.stringify({ type: "console", level, text }));
        } catch {
          // The socket is gone; the close handler stops forwarding.
        }
      };
    }
    restoreConsole = () => {
      for (const level of CONSOLE_LEVELS) {
        console[level] = originals.get(level) as (typeof console)[typeof level];
      }
    };
  };

  const stopConsoleForwarding = (): void => {
    restoreConsole?.();
    restoreConsole = undefined;
  };

  connect();
  return {
    enabled: true,
    close() {
      closed = true;
      stopConsoleForwarding();
      socket?.close();
    },
  };
}

function stringifyConsoleArgument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
