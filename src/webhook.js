const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "notification-state.json");

class Webhook {
  constructor(config, logger) {
    this.url = process.env.WEBHOOK_URL;

    if (!this.url) {
      throw new Error("WEBHOOK_URL not found in .env");
    }

    this.logger = logger;
    this.state = this.loadState();
  }

  loadState() {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
      return {};
    }
  }

  saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  today() {
    return new Date().toISOString().split("T")[0];
  }

  alreadySent(product) {
    return this.state[product.url] === this.today();
  }

  markSent(product) {
    this.state[product.url] = this.today();
    this.saveState();
  }

  async send(product) {
    if (this.alreadySent(product)) {
      this.logger.info(product.name, "Notification already sent today.");
      return;
    }

    const payload = {
      source: "Amul Stock Monitor",
      message: "Product Available",
      description: `${product.name} is available.`,
      metaData: {},
    };

    const retries = [0, 2000, 4000, 8000];

    for (let attempt = 0; attempt < retries.length; attempt++) {
      if (retries[attempt] > 0) {
        await new Promise((r) => setTimeout(r, retries[attempt]));
      }

      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        this.markSent(product);

        this.logger.success(product.name, "Webhook sent successfully.");

        return;
      } catch (err) {
        this.logger.warn(
          product.name,
          `Webhook attempt ${attempt + 1} failed: ${err.message}`,
        );
      }
    }

    this.logger.error(product.name, "Webhook failed after all retry attempts.");
  }
}

module.exports = Webhook;
