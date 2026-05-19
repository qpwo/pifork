import { type Context, complete, getModel } from "@earendil-works/pi-ai";
import { i18n } from "@mariozechner/mini-lit";
import { Badge } from "@mariozechner/mini-lit/dist/Badge.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getAppStorage } from "../storage/app-storage.js";
import { applyProxyIfNeeded } from "../utils/proxy-utils.js";
import { Input } from "./Input.js";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";

// Test models for each provider
const TEST_MODELS: Record<string, string> = {
	anthropic: "claude-haiku-4-5",
	openai: "gpt-4o-mini",
	google: "gemini-2.5-flash",
	groq: "openai/gpt-oss-20b",
	openrouter: "z-ai/glm-4.6",
	"vercel-ai-gateway": "anthropic/claude-opus-4.5",
	cerebras: "gpt-oss-120b",
	xai: "grok-4-fast-non-reasoning",
	zai: "glm-4.5-air",
};

@customElement("provider-key-input")
export class ProviderKeyInput extends LitElement {
	@property() provider = "";
	@state() private keyInput = "";
	@state() private testing = false;
	@state() private failed = false;
	@state() private hasKey = false;
	@state() private inputChanged = false;

	protected createRenderRoot() {
		return this;
	}

	override async connectedCallback() {
		super.connectedCallback();
		await this.checkKeyStatus();
	}

	private async checkKeyStatus() {
		try {
			const key = await getAppStorage().providerKeys.get(this.provider);
			this.hasKey = !!key;
		} catch (error) {
			console.error("Failed to check key status:", error);
		}
	}

	private async testApiKey(provider: string, apiKey: string): Promise<boolean> {
		try {
			const modelId = TEST_MODELS[provider];
			// Returning true here for Ollama and friends. Can' know which model to use for testing
			if (!modelId) return true;

			let model = getModel(provider as any, modelId);
			if (!model) return false;

			// Get proxy URL from settings (if available)
			const proxyEnabled = await getAppStorage().settings.get<boolean>("proxy.enabled");
			const proxyUrl = await getAppStorage().settings.get<string>("proxy.url");

			// Apply proxy only if this provider/key combination requires it
			model = applyProxyIfNeeded(model, apiKey, proxyEnabled ? proxyUrl || undefined : undefined);

			const context: Context = {
				messages: [{ role: "user", content: "Reply with: ok", timestamp: Date.now() }],
			};

			const result = await complete(model, context, {
				apiKey,
				maxTokens: 200,
			} as any);

			return result.stopReason === "stop";
		} catch (error) {
			console.error(`API key test failed for ${provider}:`, error);
			return false;
		}
	}

	private async saveKey() {
		if (!this.keyInput) return;

		this.testing = true;
		this.failed = false;

		const success = await this.testApiKey(this.provider, this.keyInput);

		this.testing = false;

		if (success) {
			try {
				await getAppStorage().providerKeys.set(this.provider, this.keyInput);
				this.hasKey = true;
				this.inputChanged = false;
				this.requestUpdate();
			} catch (error) {
				console.error("Failed to save API key:", error);
				this.failed = true;
				setTimeout(() => {
					this.failed = false;
					this.requestUpdate();
				}, 5000);
			}
		} else {
			this.failed = true;
			setTimeout(() => {
				this.failed = false;
				this.requestUpdate();
			}, 5000);
		}
	}

	private isLocalhost(): boolean {
	        return window.location.hostname === "localhost";
	}

	private async saveOAuthCredentials(credentials: Record<string, unknown>): Promise<void> {
	        if (!this.isLocalhost()) return;

	        try {
	                const res = await fetch("/api/auth");
	                if (!res.ok) return;

	                const data = (await res.json()) as Record<string, unknown>;
	                data[this.provider] = { type: "oauth", ...credentials };

	                await fetch("/api/auth", {
	                        method: "POST",
	                        headers: { "Content-Type": "application/json" },
	                        body: JSON.stringify(data),
	                });
	        } catch (error) {
	                console.error("Failed to save OAuth credentials:", error);
	        }
	}

	private async startOAuthLogin() {
	        const providerInfo = getOAuthProvider(this.provider);
	        if (!providerInfo) return;

	        try {
	                this.testing = true;
	                this.failed = false;
	                this.requestUpdate();

	                const credentials = await providerInfo.login({
	                        onAuth: (info) => {
	                                window.open(info.url, "_blank");
	                        },
	                        onPrompt: async (prompt) => {
	                                const result = window.prompt(prompt.message + "\n" + (prompt.placeholder || ""));
	                                if (!result) throw new Error("Canceled by user");
	                                return result;
	                        },
	                        onProgress: (msg) => {
	                                console.log("[OAuth Progress]", msg);
	                        }
	                });

	                const apiKey = providerInfo.getApiKey(credentials);
	                const success = await this.testApiKey(this.provider, apiKey);
	                if (success) {
	                        await getAppStorage().providerKeys.set(this.provider, apiKey);
	                        await this.saveOAuthCredentials(credentials as Record<string, unknown>);
	                        this.hasKey = true;
	                        this.inputChanged = false;
	                } else {
	                        throw new Error("OAuth key test failed");
	                }
	        } catch (err) {
	                console.error("OAuth login failed:", err);
	                this.failed = true;
	                setTimeout(() => {
	                        this.failed = false;
	                        this.requestUpdate();
	                }, 5000);
	        } finally {
	                this.testing = false;
	                this.requestUpdate();
	        }
	}

	render() {
		return html`
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium capitalize text-foreground">${this.provider}</span>
					${
						this.testing
							? Badge({ children: i18n("Testing..."), variant: "secondary" })
							: this.hasKey
								? html`<span class="text-green-600 dark:text-green-400">✓</span>`
								: ""
					}
					${this.failed ? Badge({ children: i18n("✗ Invalid"), variant: "destructive" }) : ""}
				</div>
				<div class="flex items-center gap-2">
					${Input({
						type: "password",
						placeholder: this.hasKey ? "••••••••••••" : i18n("Enter API key"),
						value: this.keyInput,
						onInput: (e: Event) => {
							this.keyInput = (e.target as HTMLInputElement).value;
							this.inputChanged = true;
							this.requestUpdate();
						},
						className: "flex-1",
					})}
					${Button({
					        onClick: () => this.saveKey(),
					        variant: "default",
					        size: "sm",
					        disabled: !this.keyInput || this.testing || (this.hasKey && !this.inputChanged),
					        children: i18n("Save"),
					})}
					${
					        getOAuthProvider(this.provider)
					                ? Button({
					                                onClick: () => this.startOAuthLogin(),
					                                variant: "outline",
					                                size: "sm",
					                                disabled: this.testing,
					                                children: "Sign in with " + (getOAuthProvider(this.provider)?.name ?? "OAuth"),
					                        })
					                : ""
					}
					</div>
					</div>
					`;
					}
					}
