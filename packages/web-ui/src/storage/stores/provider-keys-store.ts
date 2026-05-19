import { Store } from "../store.js";
import type { StoreConfig } from "../types.js";

type LocalAuthCredential =
        | {
                        type: "api_key";
                        key: string;
          }
        | {
                        type: "oauth";
                        access: string;
                        refresh: string;
                        expires: number;
                        [key: string]: unknown;
          };

/**
 * Store for LLM provider API keys (Anthropic, OpenAI, etc.).
 */
export class ProviderKeysStore extends Store {
        getConfig(): StoreConfig {
                return {
                        name: "provider-keys",
                };
        }

        async get(provider: string): Promise<string | null> {
                const key = await this.getLocalProviderKey(provider);
                if (key) {
                        await this.getBackend().set("provider-keys", provider, key);
                        return key;
                }
                return this.getBackend().get("provider-keys", provider);
        }

        async set(provider: string, key: string): Promise<void> {
                await this.getBackend().set("provider-keys", provider, key);
                await this.writeLocalProviderCredential(provider, { type: "api_key", key });
        }

        async delete(provider: string): Promise<void> {
                await this.getBackend().delete("provider-keys", provider);
                const data = await this.readLocalAuth();
                if (!data) return;
                delete data[provider];
                await this.writeLocalAuth(data);
        }

        async list(): Promise<string[]> {
                return this.getBackend().keys("provider-keys");
        }

        async has(provider: string): Promise<boolean> {
                return (await this.get(provider)) !== null;
        }

        private async getLocalProviderKey(provider: string): Promise<string | null> {
                if (!isLocalhost()) return null;
                try {
                        const res = await fetch("/api/auth-key?provider=" + encodeURIComponent(provider));
                        if (!res.ok) return null;
                        const data = (await res.json()) as { key?: unknown };
                        return typeof data.key === "string" ? data.key : null;
                } catch {
                        return null;
                }
        }

        private async readLocalAuth(): Promise<Record<string, LocalAuthCredential> | null> {
                if (!isLocalhost()) return null;
                try {
                        const res = await fetch("/api/auth");
                        if (!res.ok) return null;
                        return (await res.json()) as Record<string, LocalAuthCredential>;
                } catch {
                        return null;
                }
        }

        private async writeLocalProviderCredential(provider: string, credential: LocalAuthCredential): Promise<void> {
                const data = await this.readLocalAuth();
                if (!data) return;
                data[provider] = credential;
                await this.writeLocalAuth(data);
        }

        private async writeLocalAuth(data: Record<string, LocalAuthCredential>): Promise<void> {
                await fetch("/api/auth", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(data),
                });
        }
}

function isLocalhost(): boolean {
        if (typeof window === "undefined") return false;
        return window.location.hostname === "localhost";
}
