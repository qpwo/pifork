import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { getAgentDir } from "./config.js";
import { AuthStorage, FileAuthStorageBackend } from "./core/auth-storage.js";

const MIME_TYPES: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".ico": "image/x-icon",
};

const moduleDir = dirname(fileURLToPath(import.meta.url));

export async function handleWebCommand(args: string[]): Promise<boolean> {
        if (args[0] !== "web") return false;

        const portArgIndex = args.indexOf("--port");
        const port = portArgIndex !== -1 && args[portArgIndex + 1] ? parseInt(args[portArgIndex + 1], 10) : 19200;
        const webUiDir = findWebUiDir();

        if (!webUiDir) {
                console.error(chalk.red("Could not find web-ui dist directory. Did you build the web UI?"));
                process.exit(1);
        }

        const server = createServer((req, res) => {
                void handleRequest(req, res, webUiDir, port);
        });

        server.listen(port, "localhost", () => {
                console.log(chalk.green("\n  Web UI is running at http://localhost:" + port + "\n"));
        });

        await new Promise<void>(() => {});
        return true;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, webUiDir: string, port: number): Promise<void> {
        const url = new URL(req.url || "/", "http://" + req.headers.host);
        const pathname = url.pathname;
        const expectedOrigin = "http://localhost:" + port;
        const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
        const isApiRequest = pathname.startsWith("/api/");

        if (origin === expectedOrigin) {
                res.setHeader("Access-Control-Allow-Origin", expectedOrigin);
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type");
                res.setHeader("Vary", "Origin");
        }

        if (isApiRequest && origin && origin !== expectedOrigin) {
                sendJson(res, 403, { error: "forbidden origin" });
                return;
        }

        if (req.method === "OPTIONS") {
                res.writeHead(origin === expectedOrigin ? 204 : 403);
                res.end();
                return;
        }

        if (pathname === "/api/auth") {
                await handleAuth(req, res);
                return;
        }

        if (pathname === "/api/auth-key") {
                await handleAuthKey(url, res);
                return;
        }

        if (pathname === "/api/proxy" || pathname === "/api/proxy/") {
                await handleProxy(req, res, url);
                return;
        }

        handleStatic(pathname, res, webUiDir);
}

function findWebUiDir(): string | undefined {
        const candidates = [
                join(process.cwd(), "web-ui"),
                join(dirname(process.execPath), "web-ui"),
                join(dirname(process.execPath), "../Resources/web-ui"),
                join(moduleDir, "../../../web-ui/example/dist"),
                join(moduleDir, "../../web-ui/example/dist"),
                join(moduleDir, "web-ui"),
                join(moduleDir, "../web-ui"),
                join(moduleDir, "../../web-ui"),
        ];

        return candidates.find((candidate) => existsSync(join(candidate, "index.html")));
}

async function handleAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const authPath = join(getAgentDir(), "auth.json");

        if (req.method === "GET") {
                sendJson(res, 200, existsSync(authPath) ? JSON.parse(readFileSync(authPath, "utf-8")) : {});
                return;
        }

        if (req.method !== "POST") {
                sendJson(res, 405, { error: "method not allowed" });
                return;
        }

        const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"].toLowerCase() : "";
        if (!contentType.startsWith("application/json")) {
                sendJson(res, 415, { error: "content-type must be application/json" });
                return;
        }

        const body = await readBody(req);
        let parsed: unknown;
        try {
                parsed = JSON.parse(body);
        } catch {
                sendJson(res, 400, { error: "invalid json" });
                return;
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                sendJson(res, 400, { error: "auth json must be an object" });
                return;
        }

        const storage = new FileAuthStorageBackend(authPath);
        storage.withLock(() => ({ result: true, next: JSON.stringify(parsed, null, 2) }));
        sendJson(res, 200, { success: true });
}

async function handleAuthKey(url: URL, res: ServerResponse): Promise<void> {
        const provider = url.searchParams.get("provider");
        if (!provider) {
                sendJson(res, 400, { error: "missing provider" });
                return;
        }

        const apiKey = await AuthStorage.create(join(getAgentDir(), "auth.json")).getApiKey(provider, { includeFallback: false });
        sendJson(res, 200, apiKey ? { key: apiKey } : {});
}

async function handleProxy(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
        const target = url.searchParams.get("url");
        if (!target || !/^https?:\/\//.test(target)) {
                sendJson(res, 400, { error: "missing or invalid url" });
                return;
        }

        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
                const lower = name.toLowerCase();
                if (
                        lower === "host" ||
                        lower === "connection" ||
                        lower === "content-length" ||
                        lower === "origin" ||
                        lower === "referer" ||
                        lower === "accept-encoding" ||
                        lower.startsWith("sec-fetch-")
                ) {
                        continue;
                }
                if (typeof value === "string") {
                        headers[name] = value;
                } else if (Array.isArray(value)) {
                        headers[name] = value.join(", ");
                }
        }

        try {
                const response = await fetch(target, {
                        method: req.method,
                        headers,
                        body: req.method === "GET" || req.method === "HEAD" ? undefined : await readBodyBuffer(req),
                });

                for (const [name, value] of response.headers.entries()) {
                        const lower = name.toLowerCase();
                        if (lower === "content-encoding" || lower === "transfer-encoding" || lower === "content-length") {
                                continue;
                        }
                        res.setHeader(name, value);
                }

                res.writeHead(response.status);
                res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
                console.error(error);
                sendJson(res, 502, { error: "proxy failed" });
        }
}

function handleStatic(pathname: string, res: ServerResponse, webUiDir: string): void {
        const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        let filePath = normalize(join(webUiDir, requested));

        if (!filePath.startsWith(normalize(webUiDir))) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
        }

        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
                filePath = join(webUiDir, "index.html");
        }

        const ext = extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(readFileSync(filePath));
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<string> {
        return (await readBodyBuffer(req)).toString("utf-8");
}

async function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
}
