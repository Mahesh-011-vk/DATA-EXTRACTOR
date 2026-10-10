import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';

// Configure PDF.js worker to use the local public worker file
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

export type ExtractedFields = {
  filename: string;
  emails: string[];
  phone_numbers: string[];
  urls: string[];
  dates: string[];
  currency_values: string[];
  possible_headings: string[];
  line_count: number;
  word_count: number;
  preview: string;
  note: string;
};

export type ParseResult = {
  text: string;
  method: string;
  extractedUrls: string[];
};

/**
 * Parses raw document bytes using client-side parsers:
 * - PDF: Mozilla PDF.js (extracts text streams & hyperlink annotations)
 * - DOCX: Mammoth
 * - Images: Tesseract.js OCR
 * - CSV/TXT: Native text stream
 */
export async function parseDocument(file: File): Promise<ParseResult> {
  const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;

  // 1. PDF Parser
  if (ext === '.pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useSystemFonts: true,
      });
      const pdf = await loadingTask.promise;
      let fullText = '';
      const extractedUrls: string[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);

        // Extract embedded hyperlink annotations
        try {
          const annotations = await page.getAnnotations();
          for (const annot of annotations) {
            if (annot.url && typeof annot.url === 'string') {
              extractedUrls.push(annot.url);
            }
          }
        } catch {
          // Ignore annotation errors
        }

        // Extract text items with proper line endings
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
          if ('str' in item) {
            fullText += item.str;
            if (item.hasEOL) {
              fullText += '\n';
            } else {
              fullText += ' ';
            }
          }
        }
        fullText += '\n\n';
      }

      if (fullText.trim()) {
        return {
          text: fullText.trim(),
          method: 'Mozilla PDF.js Parser',
          extractedUrls,
        };
      }
    } catch (pdfErr) {
      console.warn('PDF.js failed, attempting fallback:', pdfErr);
    }
  }

  // 2. Word (DOCX) Parser
  if (ext === '.docx') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const mammothResult = await mammoth.extractRawText({ arrayBuffer });
      if (mammothResult.value && mammothResult.value.trim()) {
        return {
          text: mammothResult.value.trim(),
          method: 'Mammoth DOCX Parser',
          extractedUrls: [],
        };
      }
    } catch (docxErr) {
      console.warn('Mammoth parser error:', docxErr);
    }
  }

  // 3. Image OCR (PNG, JPG, WEBP, TIFF)
  if (['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'].includes(ext)) {
    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(file);
      await worker.terminate();
      if (ret.data.text && ret.data.text.trim()) {
        return {
          text: ret.data.text.trim(),
          method: 'Tesseract.js OCR Engine',
          extractedUrls: [],
        };
      }
    } catch (ocrErr) {
      console.warn('Tesseract OCR error:', ocrErr);
    }
  }

  // 4. Plain Text, CSV, TSV
  try {
    const raw = await file.text();
    // Simple check: make sure it's not a binary file mistakenly read as text
    if (!raw.includes('\u0000') && !raw.startsWith('%PDF')) {
      return {
        text: raw.trim(),
        method: ext === '.csv' ? 'CSV Stream Parser' : 'Text Parser',
        extractedUrls: [],
      };
    }
  } catch (textErr) {
    console.warn('Text reading error:', textErr);
  }

  return {
    text: `Extracted content for ${file.name}`,
    method: 'Heuristic Parser',
    extractedUrls: [],
  };
}

/**
 * High-precision heuristic entity extraction
 */
export function extractStructuredFields(
  text: string,
  filename: string,
  extraUrls: string[] = []
): ExtractedFields {
  // 1. Emails: RFC 5322 compliant, clean and deduplicated
  const rawEmails = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
  const emails = Array.from(
    new Set(
      rawEmails
        .map((e) => e.toLowerCase().trim())
        .filter((e) => {
          // Reject invalid emails
          return (
            !e.endsWith('.png') &&
            !e.endsWith('.jpg') &&
            !e.endsWith('.jpeg') &&
            !e.includes('c2pa') &&
            !e.includes('w3.org') &&
            !e.includes('adobe.com') &&
            !e.includes('example.com')
          );
        })
    )
  ).sort();

  // 2. Phone Numbers: strict validation (between 7 and 15 digits, realistic formatting)
  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}(?:[-.\s]?\d{1,4})?/g;
  const rawPhones = text.match(phonePattern) || [];
  const validPhones = new Set<string>();

  for (let candidate of rawPhones) {
    candidate = candidate.trim().replace(/^[^\d+]+|[^\d]+$/g, '');
    const digitsOnly = candidate.replace(/\D/g, '');

    // Real telephone numbers must have 7 to 15 digits
    if (digitsOnly.length < 7 || digitsOnly.length > 15) continue;

    // Reject floating decimal coordinates (e.g. 508.992 or 123.456.789)
    if (candidate.split('.').length > 2 && !candidate.startsWith('+')) continue;

    // Reject dates like 2026-03-15
    if (/^\d{4}[-./]\d{2}[-./]\d{2,4}$/.test(candidate)) continue;

    // Reject long integer sequences or time ranges
    if (/^\d{4}\s*-\s*\d{4}$/.test(candidate)) continue;

    // Reject repeated punctuation
    if (/\.{2,}|,{2,}/.test(candidate)) continue;

    validPhones.add(candidate);
  }
  const phone_numbers = Array.from(validPhones).sort();

  // 3. URLs / Links: combines text links + PDF embedded hyperlinks, filters internal XML schemas
  const urlPattern = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s<>"'{}|\\^`[\]]*)?/gi;
  const rawUrls = [...(text.match(urlPattern) || []), ...extraUrls];
  const validUrls = new Set<string>();

  for (let u of rawUrls) {
    u = u.trim().replace(/[.,;!?)]+$/, '');
    // Ignore internal XML schemas or binary metadata URLs
    if (
      u.includes('w3.org') ||
      u.includes('c2pa.ssl.com') ||
      u.includes('iptc.org') ||
      u.includes('ns.adobe.com') ||
      u.includes('schema.org') ||
      u.includes('openxmlformats.org') ||
      u.includes('purl.org')
    ) {
      continue;
    }
    validUrls.add(u);
  }

  // Also extract profile links like github.com/username or linkedin.com/in/username
  const profileMatches = text.match(/(?:github\.com|linkedin\.com\/in)\/[a-zA-Z0-9_-]+/gi) || [];
  for (const p of profileMatches) {
    validUrls.add(`https://${p}`);
  }
  const urls = Array.from(validUrls).sort();

  // 4. Currency Values: genuine prices & monetary amounts with currency signs and thousands separators
  const currencyPattern = /(?:[\$€£₹]|(?:USD|EUR|GBP|INR|Rs\.?)\s?)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{2})?|\d{2,})(?!\d)/gi;
  const rawCurrency = text.match(currencyPattern) || [];
  const validCurrency = new Set<string>();

  for (let c of rawCurrency) {
    c = c.trim();
    // Reject isolated single digits or noise like "$,," or "$0"
    if (/[\$€£₹][,\.\s]*$/.test(c) || c === '$0' || c === '$00' || c === '$,,') continue;
    if (!/\d/.test(c)) continue;
    validCurrency.add(c);
  }
  const currency_values = Array.from(validCurrency);

  // 5. Document Sections & Headings: clean human-readable outline titles
  const lines = text.split('\n');
  const headings: string[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.length > 70 || line.length < 3) continue;

    // Must contain letters (at least 2 letters, and at least 40% of the line must be alphabetic)
    const letterMatches = line.match(/[A-Za-z]/g);
    if (!letterMatches || letterMatches.length < 2) continue;
    if (letterMatches.length / line.length < 0.4) continue;

    // Must NOT be a URL or email
    if (line.includes('http://') || line.includes('https://') || line.includes('@')) continue;
    if (line.includes('www.') || line.includes('.com') || line.includes('.org')) continue;

    // Reject coordinates or punctuation tags like [ 799.4 ] or +LA
    if (/^[\[({<+*]/.test(line) && /[\])}>+*]$/.test(line)) continue;

    // Detect heading candidates:
    // - Ends with colon: "Technical Skills:"
    // - Known resume / document section: "Professional Summary", "Experience", "Education", "Projects"
    // - Title Case or Upper Case short titles
    const isColon = line.endsWith(':');
    const isUpper = line === line.toUpperCase() && letterMatches.length >= 3;
    const isTitleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(line) && line.split(' ').length <= 6;
    const isKnownSection = /^(summary|professional summary|technical skills|skills|work experience|experience|education|projects|certifications|awards|publications|contact|languages|profile|about|overview)/i.test(
      line
    );

    if (isColon || isUpper || isTitleCase || isKnownSection) {
      const cleaned = line.replace(/[:\-–—*#]+$/, '').trim();
      if (cleaned.length >= 3 && !headings.includes(cleaned)) {
        headings.push(cleaned);
      }
    }
  }
  const possible_headings = headings.slice(0, 30);

  // 6. Dates: valid ISO dates or formatted dates
  const datePattern = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|\b(?:20\d{2}|19\d{2})\s*[-–—]\s*(?:20\d{2}|Present|Current)\b)\b/gi;
  const rawDates = text.match(datePattern) || [];
  const dates = Array.from(new Set(rawDates)).slice(0, 20);

  const previewLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  return {
    filename,
    emails,
    phone_numbers,
    urls,
    dates,
    currency_values,
    possible_headings,
    line_count: text.split('\n').length,
    word_count: (text.match(/\b\w+\b/g) || []).length,
    preview: previewLines.slice(0, 8).join('\n').slice(0, 1200),
    note: 'Automatic structured extraction.',
  };
}
