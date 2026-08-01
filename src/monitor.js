const { setTimeout: sleep } = require("timers/promises");
const fs = require("fs/promises");
const path = require("path");

class Monitor {
  constructor(product, page, config, logger, webhook) {
    this.product = product;
    this.page = page;
    this.config = config;
    this.logger = logger;
    this.webhook = webhook;

    this.stopped = false;
  }

  async initialize() {
    this.logger.info(this.product.name, "Opening product page...");

    // Let Playwright handle operation timeouts.
    this.page.setDefaultTimeout(10000);
    this.page.setDefaultNavigationTimeout(15000);

    await this.page.goto(this.product.url, {
      waitUntil: "domcontentloaded",
      timeout: this.config.browser.timeout,
    });

    this.logger.info(this.product.name, `URL: ${this.page.url()}`);
    this.logger.info(this.product.name, `Title: ${await this.page.title()}`);

    await this.ensurePincodeSelected();
  }

  isMonitoringWindow() {
    const hour = new Date().getHours();

    return (
      hour >= this.config.monitor.startHour &&
      hour < this.config.monitor.endHour
    );
  }

  async waitUntilMorning() {
    const now = new Date();
    const wake = new Date(now);

    if (now.getHours() >= this.config.monitor.endHour) {
      wake.setDate(wake.getDate() + 1);
    }

    wake.setHours(this.config.monitor.startHour, 0, 0, 0);

    const ms = wake - now;

    this.logger.info(
      this.product.name,
      `Sleeping until ${wake.toLocaleString()}`,
    );

    await sleep(ms);
  }

  async captureDiagnostics(reason) {
    try {
      const dir = path.join(process.cwd(), "logs");

      await fs.mkdir(dir, { recursive: true });

      const stamp = Date.now();

      await this.page.screenshot({
        path: path.join(dir, `${this.product.id}-${reason}-${stamp}.png`),
        fullPage: true,
      });

      await fs.writeFile(
        path.join(dir, `${this.product.id}-${reason}-${stamp}.html`),
        await this.page.content(),
      );

      this.logger.warn(this.product.name, `Captured diagnostics (${reason})`);
    } catch (err) {
      this.logger.warn(
        this.product.name,
        `Failed to capture diagnostics: ${err.message}`,
      );
    }
  }

  async ensurePincodeSelected() {
    const input = this.page.locator("#search");

    try {
      await input.waitFor({
        state: "visible",
        timeout: 10000,
      });
    } catch {
      // Pincode popup not present.
      return;
    }

    this.logger.info(this.product.name, "Selecting pincode...");

    await input.fill(this.config.location.pincode);

    const option = this.page.locator("#automatic a.searchitem-name").filter({
      hasText: this.config.location.pincode,
    });

    await option.waitFor({
      state: "visible",
      timeout: 10000,
    });

    await option.click();

    // Vue removes the popup without navigation.
    await this.page.waitForTimeout(3000);

    await this.page
      .waitForFunction(() => !document.querySelector("#search"), {
        timeout: 10000,
      })
      .catch(() => {});

    const stillVisible = await this.page.locator("#search").count();

    this.logger.info(
      this.product.name,
      `Pincode visible after click: ${stillVisible}`,
    );

    if (stillVisible > 0) {
      await this.captureDiagnostics("pincode");
      this.logger.warn(this.product.name, "Still on pincode page.");
    } else {
      this.logger.success(this.product.name, "Pincode selected.");
    }
  }

  async detectState() {
    await this.page.waitForTimeout(1500);

    const body = await this.page.locator("body").innerText();

    if (
      body.includes("Checking your browser") ||
      body.includes("Verify you are human") ||
      body.includes("Just a moment")
    ) {
      return "challenge";
    }

    const html = await this.page.content();

    if (!html.includes("product-buttons")) {
      await this.captureDiagnostics("product-not-loaded");
      return "unknown";
    }

    const addToCart = this.page.locator(
      ".product-buttons .buttons > a[title='Add to Cart']",
    );

    const count = await addToCart.count();

    if (count === 0) {
      await this.captureDiagnostics("missing-add-to-cart");
      return "unknown";
    }

    const button = addToCart.first();
    const isDisabled = (await button.getAttribute("disabled")) !== null;

    const soldOutVisible = await this.page
      .locator("div.alert.alert-danger")
      .filter({ hasText: "Sold Out" })
      .isVisible()
      .catch(() => false);

    // Available only when button is enabled and Sold Out banner is absent.
    if (!isDisabled && !soldOutVisible) {
      return "available";
    }

    if (isDisabled && soldOutVisible) {
      return "soldout";
    }

    // Unexpected combination.
    await this.captureDiagnostics("unknown-state");

    return "unknown";
  }

  async check() {
    this.logger.info(this.product.name, "Refreshing page...");

    await this.page.goto(this.product.url, {
      waitUntil: "domcontentloaded",
      timeout: this.config.browser.timeout,
    });

    this.logger.info(this.product.name, `Current URL: ${this.page.url()}`);

    await this.ensurePincodeSelected();

    const state = await this.detectState();

    switch (state) {
      case "available":
        this.logger.success(this.product.name, "PRODUCT AVAILABLE!");

        await this.captureDiagnostics("available");

        await this.webhook.send(this.product);

        break;

      case "soldout":
        this.logger.info(this.product.name, "Sold Out");
        break;

      case "challenge":
        this.logger.warn(this.product.name, "Cloudflare challenge detected.");

        await this.captureDiagnostics("cloudflare");

        break;

      default:
        this.logger.warn(this.product.name, "Unknown page state.");
    }
  }

  nextDelay() {
    const base = this.config.monitor.intervalMinutes * 60 * 1000;

    const jitter =
      (this.config.monitor.minJitterSeconds +
        Math.random() *
          (this.config.monitor.maxJitterSeconds -
            this.config.monitor.minJitterSeconds)) *
      1000;

    return Math.round(base + jitter);
  }

  async recover() {
    this.logger.warn(this.product.name, "Recovering in 30 seconds...");

    await sleep(30000);

    try {
      await this.page.goto(this.product.url, {
        waitUntil: "domcontentloaded",
        timeout: this.config.browser.timeout,
      });

      await this.ensurePincodeSelected();
    } catch (err) {
      this.logger.error(this.product.name, `Recovery failed: ${err.message}`);
    }
  }

  async start() {
    const initialDelay = Math.floor(Math.random() * 50000);

    this.logger.info(
      this.product.name,
      `Initial delay ${Math.round(initialDelay / 1000)}s`,
    );

    await sleep(initialDelay);

    while (!this.stopped) {
      try {
        if (!this.isMonitoringWindow()) {
          await this.waitUntilMorning();
          continue;
        }

        await this.check();
      } catch (err) {
        this.logger.error(this.product.name, err.stack || err.message);

        await this.captureDiagnostics("exception");

        await this.recover();
      }

      const delay = this.nextDelay();

      this.logger.info(
        this.product.name,
        `Next check in ${Math.round(delay / 1000)}s`,
      );

      await sleep(delay);
    }
  }

  stop() {
    this.stopped = true;
  }
}

module.exports = Monitor;
