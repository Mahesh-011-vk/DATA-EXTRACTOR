# Data Extractor AI

A full-stack document intelligence application that extracts text and common structured fields from PDFs, Word documents, text files, CSV/Excel spreadsheets, and images. Built with **React + TypeScript**, **FastAPI**, **PyMuPDF**, **Pandas**, and **Tesseract OCR**.

> A full-stack document intelligence platform featuring a modern monochrome glassmorphism dashboard. Detects and extracts structured entities (URLs/links, numbers, currencies, dates, section headings, and contacts) with real-time copy actions and persistent document storage history.

## Features

- **Document Extraction**: Upload PDFs, Word documents (DOCX), text files, CSV/Excel spreadsheets, and images (PNG, JPG, WEBP, TIFF).
- **Dual-Engine OCR**: High-speed PyMuPDF text parser with automatic Tesseract OCR fallback for scanned PDFs and image files.
- **Entity Intelligence Stream**: Instant extraction of Web URLs & Links, Numbers & Currency figures, Document Section Headings, and Contact Emails & Dates.
- **Persistent Storage History**: Save extracted documents to local session history with 1-click reloading, export, and deletion.
- **Export Options**: 1-click download of structured results in CSV or JSON format, plus raw text export (`.txt`).
- **Sample Datasets Included**: Preloaded sample contracts and CSV datasets for instant testing.
- **Modern Glassmorphic UI**: High-contrast luxury aesthetic inspired by cutting-edge fintech and developer dashboards.
- **Backend API**: FastAPI backend with CORS, size limit validations, and automatic temporary file cleanup.

## Architecture

```text
React + TypeScript (Vite, localhost:5173)
             |
             | multipart/form-data / JSON
             v
FastAPI (localhost:8000)
  ├── PyMuPDF ............ PDF text + scanned-PDF rasterization
  ├── python-docx ........ Word paragraphs and tables
  ├── Pandas/openpyxl .... CSV/XLSX
  ├── Tesseract .......... Image OCR
  ├── Regex heuristics ... Common field detection
  └── JSON / CSV export
```

## Folder structure

```text
data-extractor-ai/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py
│   ├── .env.example
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── .env.example
├── .gitignore
└── README.md
```

## Requirements

- macOS (Apple Silicon supported), Windows, or Linux
- Python 3.11 or 3.12 recommended
- Node.js 20+ and npm
- Tesseract OCR installed for image/scanned-PDF OCR

### Install Tesseract on macOS

Install [Homebrew](https://brew.sh/) if needed, then:

```bash
brew install tesseract
tesseract --version
```

If `pytesseract` cannot find Tesseract, ensure Homebrew's bin directory is on your PATH. Apple Silicon Homebrew usually uses `/opt/homebrew/bin`.

## Run locally on a MacBook Air M3

### 1. Open Terminal and enter the project

```bash
cd data-extractor-ai
```

### 2. Create a Python environment

Use Python 3.11 or 3.12 for a predictable environment. The project does not require TensorFlow.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

### 3. Start the API

Keep this Terminal tab open:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check that the API responds:

- Health: http://127.0.0.1:8000/api/health
- Interactive API docs: http://127.0.0.1:8000/docs

### 4. Start the frontend in a second Terminal tab

From the project root:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, normally http://localhost:5173.

### 5. Try a document

Upload a small PDF, DOCX, TXT, CSV, XLSX, or image. Click **Extract data**, review the text and detected fields, then export CSV or JSON.

## Configuration

Backend settings can be placed in `backend/.env`, but the current code reads environment variables from the process; it does not automatically load `.env`. For quick local defaults, no environment file is required. Set variables directly in the terminal if you need to override them:

```bash
export MAX_FILE_MB=20
export UPLOAD_DIR=data/uploads
export CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Frontend API URL defaults to `http://localhost:8000`. To override, create `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

Restart Vite after changing frontend environment variables.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | API status |
| `POST` | `/api/extract` | Upload and extract one file |
| `POST` | `/api/export/json` | Download result JSON |
| `POST` | `/api/export/csv` | Download detected fields as CSV |

The `/api/extract` endpoint accepts `multipart/form-data` with a `file` field.

## Supported formats and notes

| Format | Extraction path | Notes |
|---|---|---|
| PDF | PyMuPDF | Scanned pages fall back to Tesseract OCR |
| DOCX | python-docx | Reads paragraphs and tables |
| TXT | UTF-8 text | Invalid bytes are replaced |
| CSV | Pandas | Parsed then normalized to text |
| XLSX | Pandas + openpyxl | Reads all sheets |
| PNG/JPG/WEBP/TIFF | Tesseract | OCR quality depends on image quality |

Legacy `.doc`, password-protected files, and arbitrary web pages are not supported in this starter. Website extraction should be implemented separately with clear permission, rate limits, and site terms in mind.

## Security and production checklist

This is a local-development portfolio project, not a hardened public upload service. Before public deployment:

- Add authentication, per-user rate limits, quotas, and request timeouts.
- Use a private temporary directory, robust cleanup in `finally`, and a scheduled cleanup policy.
- Validate file signatures as well as extensions; consider malware scanning and parser isolation.
- Do not log document contents or store sensitive files unnecessarily.
- Limit PDF page count and decompressed image dimensions to reduce resource-exhaustion risk.
- Configure exact production CORS origins and HTTPS.
- Review privacy/legal requirements before processing personal, financial, or confidential documents.
- For LLM extraction, use schema-constrained output, prompt-injection defenses, explicit consent, and a provider policy suitable for the document data.

## Roadmap

- LLM-backed schema extraction with user-defined fields.
- Batch uploads and extraction history.
- Editable results and confidence/source-span tracking.
- Table-aware extraction and document-specific templates.
- Authentication, job queue, progress updates, and persistent database.
- Unit/integration tests and CI.

## Troubleshooting

**`tesseract is not installed or it's not in your PATH`**
Run `brew install tesseract`, then `which tesseract` and restart the backend terminal.

**Frontend says API offline**
Start the FastAPI server and confirm `http://127.0.0.1:8000/api/health` works. If needed, set `VITE_API_BASE_URL` in `frontend/.env.local` and restart Vite.

**CORS error**
Set `CORS_ORIGINS` to the exact frontend origin and restart FastAPI.

**Excel import error**
Activate the backend virtual environment and run `pip install -r requirements.txt`.

**No text found**
For scanned PDFs or photos, improve resolution, contrast, and orientation. OCR may struggle with handwriting or low-quality scans.

## License

MIT — see `LICENSE`.
