# QR Forge Studio

QR Forge Studio is a studio-grade, lightweight web application for creating beautiful customizable QR codes and generating instant public web links from images.

It features an editorial, high-contrast design system, customizable QR shapes and color palettes, client-side zero-configuration cloud hosting, and multiple export options.

---

## 3 Core Capabilities

### 1. ↗ URL & Text to QR Code
- Convert any URL or plain text into a high-precision QR code.
- Auto-prepends `https://` when required.
- Quick preset destinations (Launch page, Menu link, Map pin, GitHub).

### 2. ▦ Image to QR Code (Scan to View)
- Upload any image format (PNG, JPG, WEBP, GIF, SVG).
- Automatically hosts the full-resolution image on the cloud with zero setup.
- Encodes the hosted public URL into the QR code so any smartphone camera can scan and view the original picture immediately.

### 3. 🔗 Image to Link Generator (NEW)
- Instant image hosting and link generator.
- Generates multiple shareable formats with one-click copying:
  - **Shareable Page Link** (opens the image on a clean mobile-friendly viewer)
  - **Direct Image URL** (raw `.png` / `.jpg` file link)
  - **Markdown Code** (`![image](url)` for GitHub, Reddit, Discord)
  - **HTML Embed Code** (`<img src="..." />` for websites and blogs)
  - **BBCode** (`[img]url[/img]` for forums)
- Live asset metadata: dimensions, file size, and file format.
- Instant switch: convert your newly generated image link into a QR code with a single click.

---

## Studio Styling & Export

- **Module Shapes**: Soft rounded, Classic square, Dot matrix, Classy, Classy rounded, Extra rounded.
- **Corner Shapes**: Extra rounded, Square, Dot.
- **Color Customization**: Real-time foreground and background color pickers with hex labels.
- **Curated Palettes**: Classic Noir, Acid Studio, Coral Warmth, Sage Moss, Acid Dark.
- **Export Formats**:
  - High-resolution **PNG** (720 × 720 px)
  - Infinitely scalable **Vector SVG** for print and graphic design
  - Copy QR Image directly to clipboard
  - Copy destination link directly

---

## Cloud Storage Engine

- **Default Cloud Engine**: Powered by instant zero-friction cloud hosting with global CDN delivery. No registration or API keys needed.
- **Custom ImgBB Support**: Option in Storage Settings to connect a personal free [ImgBB API Key](https://api.imgbb.com/) for permanent image hosting.
- **Local Fallback**: Automatically falls back to local server storage when running offline or with the included Node.js server.

---

## Quick Start

### Option 1: Static Hosting (GitHub Pages / Vercel / Netlify)
The frontend is completely self-contained. You can deploy it to **GitHub Pages**, open `index.html` in any browser, or use Live Server.

### Option 2: Run with Node.js
```bash
# Start the server
node server.js

# Or with npm
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 3: Docker
```bash
docker build -t qr-forge .
docker run -p 3000:3000 qr-forge
```

---

## Tech Stack

- **HTML5 & Vanilla CSS3**: Custom editorial studio design system, responsive layout, dark/light theme toggle.
- **Modern JavaScript**: Client-side QR rendering via `QRCodeStyling`, async image uploads with upload progress tracking, clipboard API integration.
- **Node.js**: Minimal zero-dependency HTTP server with CORS and upload endpoints.

---

## License

MIT
