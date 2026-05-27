# ARVION BMT (Benchmark Test) Dashboard

## 🚀 Overview
ARVION BMT Dashboard is a specialized developer and sales engineering tool designed to monitor, measure, and demonstrate the performance and traffic-saving capabilities of the **ARVION CDN** in real-time.

Are you tired of complex CDN integration tests? With this extension, you can perform a **Zero-Config Proof of Concept (PoC)** on any live website without modifying a single line of source code or changing DNS records.

## 🎯 Key Features

### 1. Zero-Config B2B Demo Mode (Dynamic Redirection)
- **Real-time Domain Mapping**: Instantly map a customer's original image/media domain (e.g., `img.customer.com`) to the ARVION CDN domain (e.g., `customer.cdn.arvioncore.com`) via the extension popup.
- **Transparent Network Interception**: Uses Chrome's highly optimized `declarativeNetRequest` API to route requests to the CDN at the network layer.
- **No Code Changes Required**: Safely demonstrate ARVION's blazing-fast WebP/AVIF media delivery and bandwidth savings on live production sites without touching the DOM or breaking front-end frameworks.

### 2. Comprehensive Traffic Monitoring (DevTools Dashboard)
- **Live Traffic Analysis**: Open Chrome DevTools and navigate to the "ARVION DASHBOARD" panel to see every media request processed.
- **Savings Calculation**: Automatically compares the `Original Size` vs. `Compressed Size` and calculates the real-time compression ratio (e.g., 85% saved).
- **Video & Image Support**: Fully supports monitoring both static images and video chunk (`206 Partial Content`) requests.
- **Cache Hit/Miss Status**: Monitor S3 and Edge caching states directly from response headers.
- **Media Preview**: Click on any intercepted media row to open a built-in player/viewer to inspect visual quality and latency.

## 🛠 How to Use
1. **Set Up Redirection**: Click the ARVION extension icon in the toolbar. Enter the original domain and your ARVION target domain, then toggle the **Demo Mode** to ON.
2. **Open Dashboard**: Press `F12` to open Chrome DevTools, and click on the `ARVION DASHBOARD` tab.
3. **Experience the Magic**: Refresh the website. Watch the images load instantly from the CDN while the dashboard populates with precise traffic savings metrics.

## 🔒 Privacy & Permissions
This extension is strictly a B2B testing and benchmarking tool. 
- The **`declarativeNetRequest`** permission is used exclusively to redirect media requests based on user-defined mappings in the popup.
- The extension does not collect, store, or transmit any user browsing data or personal information to external servers. All monitoring and mapping are handled locally within the browser.

---
**Bring the power of ARVION CDN to your fingertips. Start proving your performance today.**
