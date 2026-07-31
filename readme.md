# Amul Stock Monitor

A lightweight Playwright-based stock monitor that checks Amul product availability and sends a webhook notification when a product comes back in stock.

## Features

* One browser instance
* One tab per product
* Automatic page refresh
* Randomized polling interval
* Shared browser session across all products
* Persistent Chromium profile
* Automatic tab recovery on crashes
* Webhook notification
* One notification per product per day
* Runs only during a configurable monitoring window (default: 6:00 AM to 12:00 PM)
* Runs as a systemd service

---

## Requirements

* Ubuntu 22.04+ (recommended)
* Node.js 20+
* npm
* Playwright

---

## Project Structure

```text
amul-stock-monitor/
│
├── browser-data/
├── logs/
├── .env
├── .gitignore
├── config.json
├── index.js
├── logger.js
├── monitor.js
├── notification-state.json
├── package.json
├── webhook.js
└── README.md
```

---

## Installation

Clone or copy the project.

```bash
git clone <repository-url>

cd amul-stock-monitor
```
One command Install dependencies.

```bash
npm run initialize
```

(or alternatively) Manually Install dependencies.

```bash
npm install
```

Install Playwright Chromium.

```bash
npx playwright install chromium
```

Install required Linux dependencies (first-time only).

```bash
sudo npx playwright install-deps chromium
```

---

## Environment Configuration

Create a `.env` file.

```bash
nano .env
```

Example:

```text
WEBHOOK_URL=https://your-webhook-url
```

Protect the file.

```bash
chmod 600 .env
```

---

## Product Configuration

Edit `config.json`.

Example:

```json
{
  "products": [
    {
      "name": "Amul High Protein Plain Lassi",
      "url": "https://shop.amul.com/en/product/amul-high-protein-plain-lassi-200-ml-or-pack-of-30"
    }
  ]
}
```

To monitor additional products, simply append another object to the `products` array.

Example:

```json
{
  "name": "Amul High Protein Buttermilk",
  "url": "https://shop.amul.com/..."
}
```

On the next application start, one additional browser tab will automatically be created.

---

## Running Locally

Start the monitor.

```bash
node index.js
```

---

## Running in Background

Using `nohup`:

```bash
nohup node index.js > output.log 2>&1 &
```

Stop it.

```bash
pkill -f "node index.js"
```

---

## Running with systemd

Copy the service.

```bash
sudo cp amul-stock-monitor.service /etc/systemd/system/
```

Reload systemd.

```bash
sudo systemctl daemon-reload
```

Enable automatic startup.

```bash
sudo systemctl enable amul-stock-monitor
```

Start.

```bash
sudo systemctl start amul-stock-monitor
```

Check status.

```bash
systemctl status amul-stock-monitor
```

Follow logs.

```bash
journalctl -fu amul-stock-monitor
```

Restart.

```bash
sudo systemctl restart amul-stock-monitor
```

Stop.

```bash
sudo systemctl stop amul-stock-monitor
```

Disable startup.

```bash
sudo systemctl disable amul-stock-monitor
```

---

## Monitoring Window

The monitor only checks products during the configured hours.

Example:

```
06:00 AM
↓

Check every ~5 minutes

↓

12:00 PM

↓

Sleep until next day
```

Outside this window, the application remains idle without consuming network resources.

---

## Polling Behaviour

Each product receives its own browser tab.

Each tab independently performs:

```
Open Product

↓

Random startup delay

↓

Reload

↓

Check stock

↓

Wait

↓

Repeat
```

Polling interval:

* Base interval: 5 minutes
* Random jitter: 5 to 8 seconds

This avoids synchronized requests.

---

## Availability Detection

A product is considered **available** only when all of the following conditions are true:

* Add to Cart button exists
* Add to Cart button is enabled
* Button does not contain the `disabled` class
* "Sold Out" banner is not present

Otherwise, the product is treated as unavailable.

---

## Webhook Payload

When stock becomes available, the following payload is sent:

```json
{
  "source": "Amul Stock Monitor",
  "message": "Product Available",
  "description": "<product name> is available.",
  "metaData": {}
}
```

Each product triggers **at most one notification per day**.

---

## Logs

Application logs are written to:

```text
logs/
```

Systemd logs are available through:

```bash
journalctl -fu amul-stock-monitor
```

---

## Notification State

Successful notifications are tracked in:

```text
notification-state.json
```

This prevents duplicate notifications after application restarts.

---

## Browser Profile

Chromium profile data is stored in:

```text
browser-data/
```

This keeps cookies and the authenticated browser session between restarts.

---

## Updating Products

Edit `config.json`.

Add or remove products.

Restart the service.

```bash
sudo systemctl restart amul-stock-monitor
```

---

## Updating the Webhook URL

Edit:

```text
.env
```

Then restart the service.

```bash
sudo systemctl restart amul-stock-monitor
```

---

## Troubleshooting

### Service status

```bash
systemctl status amul-stock-monitor
```

### Live logs

```bash
journalctl -fu amul-stock-monitor
```

### Check Node version

```bash
node -v
```

### Verify Playwright

```bash
npx playwright --version
```

### Verify Chromium

```bash
npx playwright install chromium
```

---

## Stopping the Monitor

```bash
sudo systemctl stop amul-stock-monitor
```

---

## Restarting the Monitor

```bash
sudo systemctl restart amul-stock-monitor
```

---

## Updating Dependencies

```bash
npm update
```
