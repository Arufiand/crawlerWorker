import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

export interface IBrowserService {
  init(): Promise<void>;
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export class PlaywrightBrowserService implements IBrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async init(): Promise<void> {
    if (this.browser) {
      return;
    }

    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });

    await this.context.route(
      "**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,mp4,css}",
      (route) => route.abort(),
    );
  }

  async newPage(): Promise<Page> {
    if (!this.context) {
      throw new Error("BrowserService not initialized. call init() first");
    }
    return this.context.newPage();
  }

  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;

    if (context) await context.close();
    if (browser) await browser.close();
  }
}
