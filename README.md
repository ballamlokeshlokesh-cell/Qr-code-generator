# QR Forge

QR Forge is a lightweight web app for generating QR codes from URLs or uploaded images. It includes a modern single-page interface, customizable QR styling, and a small Node.js server for serving the app and handling image uploads.

## Features

- Generate QR codes from a URL or text destination
- Generate QR codes for uploaded images by hosting the original image and encoding its public URL
- Customize QR appearance:
  - dot shape
  - corner shape
  - foreground color
  - background color
- Preview and download the generated QR code as a PNG
- Built-in health check endpoint for service monitoring
- Docker-ready deployment

## Project structure

- `index.html` — frontend markup
- `styles.css` — styling for the app
- `app.js` — client-side QR generation logic and UI behavior
- `server.js` — HTTP server and upload handling
- `Dockerfile` — container build for deployment
- `app.config.ts` — app configuration metadata
- `manus-routes.json` — route metadata
- `TODO.md` — project notes and future improvements

## Tech stack

- HTML, CSS, JavaScript
- Node.js runtime
- QR code rendering via `QRCodeStyling`
- Docker for containerized deployment

## Run locally

1. Clone the repository
2. Start the app:

```bash
node server.js
```

3. Open the application in a browser at:

```text
http://localhost:3000
```

If you want to use Docker:

```bash
docker build -t qr-forge .
docker run -p 3000:3000 qr-forge
```

## Environment variables

The app can optionally use the following environment variables for durable image storage:

- `MANUS_API_URL`
- `MANUS_API_KEY`

If these are not set, image uploads will return a `503` response indicating that durable storage is unavailable.

## API endpoints

- `GET /api/health` — returns service health status
- `POST /api/images` — uploads an image for QR generation workflows

## Notes

This project is designed as a simple, self-contained QR generator with minimal dependencies and a focus on quick local or containerized use.
