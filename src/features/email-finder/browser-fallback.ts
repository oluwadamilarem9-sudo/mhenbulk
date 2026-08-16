/**
 * Optional Playwright fallback for pages that publish contact details only
 * after client-side rendering. Disabled by default — serverless hosts usually
 * cannot ship a browser binary. Enable with EMAIL_FINDER_BROWSER_FALLBACK=1
 * where Playwright is installed locally or on a worker VM.
 */

export type BrowserFallbackResult = {
  html: string;
  finalUrl: string;
} | null;

type PlaywrightModule = {
  chromium: {
    launch: (options?: {
      headless?: boolean;
      args?: string[];
    }) => Promise<{
      newPage: (options?: {
        userAgent?: string;
        javaScriptEnabled?: boolean;
      }) => Promise<{
        setDefaultTimeout: (ms: number) => void;
        goto: (
          url: string,
          options?: { waitUntil?: string; timeout?: number },
        ) => Promise<{ status: () => number } | null>;
        waitForTimeout: (ms: number) => Promise<void>;
        content: () => Promise<string>;
        url: () => string;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    // Avoid a static import so builds succeed without the optional package.
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<PlaywrightModule>;
    return await dynamicImport("playwright");
  } catch {
    return null;
  }
}

export async function fetchRenderedHtml(
  url: string,
  options: { timeoutMs: number; userAgent: string },
): Promise<BrowserFallbackResult> {
  if (process.env.EMAIL_FINDER_BROWSER_FALLBACK?.trim() !== "1") {
    return null;
  }

  try {
    const playwright = await loadPlaywright();
    if (!playwright) return null;

    const browser = await playwright.chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });

    try {
      const page = await browser.newPage({
        userAgent: options.userAgent,
        javaScriptEnabled: true,
      });
      page.setDefaultTimeout(options.timeoutMs);
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      if (!response || response.status() >= 400) return null;
      await page.waitForTimeout(Math.min(1_500, Math.floor(options.timeoutMs / 4)));
      const html = await page.content();
      return { html, finalUrl: page.url() };
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    console.info("[email-finder] Browser fallback skipped", {
      url,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
