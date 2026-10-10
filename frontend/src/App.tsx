import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, Bookmark, BookmarkCheck, Check,
  Clock3, Copy, Database, DollarSign, Download, ExternalLink,
  FileImage, FileSpreadsheet, FileText, Files, FolderArchive,
  Globe, Hash, Heading, LoaderCircle, Mail, Phone, Plus,
  Search, Trash2, UploadCloud, X, Eye,
} from 'lucide-react';
import { parseDocument, extractStructuredFields } from './documentParser';

type ExtractedFields = {
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

type Result = {
  id: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  extraction_method: string;
  extracted_at: string;
  text: string;
  truncated: boolean;
  fields: ExtractedFields;
};

type StoredDocument = Result & {
  savedAt: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = '.pdf,.docx,.txt,.csv,.xlsx,.png,.jpg,.jpeg,.webp,.tif,.tiff';
const STORAGE_KEY = 'data_extractor_saved_extractions';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function IconForFile({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff'].includes(ext || '')) return <FileImage size={15} />;
  if (['csv', 'xlsx'].includes(ext || '')) return <FileSpreadsheet size={15} />;
  return <FileText size={15} />;
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [savedDocs, setSavedDocs] = useState<StoredDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [activeNav, setActiveNav] = useState<'overview' | 'fields' | 'text' | 'storage'>('overview');
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState(false);

  // Load saved documents from LocalStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSavedDocs(parsed);
          // If no active result, auto-load the most recently saved document
          if (parsed.length > 0) {
            setResult(parsed[0]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to parse saved documents from storage', err);
    }
  }, []);

  // Save documents to LocalStorage whenever savedDocs changes
  const persistDocs = (docs: StoredDocument[]) => {
    setSavedDocs(docs);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
    } catch (err) {
      console.error('Failed to save to storage', err);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json();
      })
      .then(() => setHealth('online'))
      .catch(() => setHealth('offline'));
  }, []);

  const chooseFile = useCallback((picked: File | null) => {
    setError('');
    if (!picked) return;
    const ext = `.${picked.name.split('.').pop()?.toLowerCase()}`;
    if (!ACCEPT.split(',').includes(ext)) {
      setError('Unsupported file type. Choose PDF, DOCX, TXT, CSV, XLSX, PNG, or JPG.');
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError('File exceeds 20 MB limit.');
      return;
    }
    setFile(picked);
  }, []);

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0] ?? null);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  };

  const extractClientSide = async (targetFile: File): Promise<Result> => {
    const { text, method, extractedUrls } = await parseDocument(targetFile);
    const fields = extractStructuredFields(text, targetFile.name, extractedUrls);

    return {
      id: String(Date.now()),
      filename: targetFile.name,
      file_type: targetFile.name.split('.').pop()?.toUpperCase() || 'FILE',
      size_bytes: targetFile.size,
      extraction_method: method || 'Client Parser (Vercel Web)',
      extracted_at: new Date().toISOString(),
      text: text.slice(0, 200000),
      truncated: text.length > 200000,
      fields,
    };
  };

  const extract = async (fileToExtract?: File) => {
    const targetFile = fileToExtract || file;
    if (!targetFile) return;
    setBusy(true);
    setError('');
    try {
      let newResult: Result;
      try {
        const body = new FormData();
        body.append('file', targetFile);
        const response = await fetch(`${API_BASE}/api/extract`, { method: 'POST', body });
        if (response.ok) {
          const payload = await response.json();
          newResult = payload as Result;
        } else {
          newResult = await extractClientSide(targetFile);
        }
      } catch {
        // Fallback to client-side extraction if backend API is not hosted or unreachable
        newResult = await extractClientSide(targetFile);
      }

      setResult(newResult);

      // Auto-store extracted document into storage history
      const storedItem: StoredDocument = {
        ...newResult,
        savedAt: new Date().toISOString(),
      };
      const updated = [
        storedItem,
        ...savedDocs.filter((d) => d.id !== newResult.id && d.filename !== newResult.filename),
      ].slice(0, 20);
      persistDocs(updated);
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction error.');
    } finally {
      setBusy(false);
    }
  };

  const loadSampleFile = async (name: string, path: string) => {
    try {
      setBusy(true);
      setError('');
      const res = await fetch(path);
      const blob = await res.blob();
      const sample = new File([blob], name, { type: blob.type || 'text/plain' });
      setFile(sample);
      await extract(sample);
    } catch {
      setError('Could not load sample file.');
      setBusy(false);
    }
  };

  // Explicit Save Document action
  const saveCurrentDocument = () => {
    if (!result) return;
    const exists = savedDocs.some((d) => d.id === result.id || d.filename === result.filename);
    if (!exists) {
      const storedItem: StoredDocument = {
        ...result,
        savedAt: new Date().toISOString(),
      };
      persistDocs([storedItem, ...savedDocs]);
    }
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2500);
  };

  const deleteSavedDoc = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedDocs.filter((d) => d.id !== id);
    persistDocs(updated);
    if (result?.id === id) {
      setResult(updated[0] || null);
    }
  };

  const clearAllSavedDocs = () => {
    if (confirm('Clear all saved extractions from local storage?')) {
      persistDocs([]);
      setResult(null);
      setFile(null);
    }
  };

  const download = (format: 'json' | 'csv') => {
    if (!result) return;
    try {
      let blob: Blob;
      if (format === 'json') {
        const content = JSON.stringify(result, null, 2);
        blob = new Blob([content], { type: 'application/json' });
      } else {
        const rows = [
          'field,value',
          `filename,"${result.filename}"`,
          `file_type,"${result.file_type}"`,
          `extraction_method,"${result.extraction_method}"`,
          `word_count,${result.fields.word_count}`,
          `line_count,${result.fields.line_count}`,
          `emails,"${result.fields.emails.join('; ')}"`,
          `phone_numbers,"${result.fields.phone_numbers.join('; ')}"`,
          `currency_values,"${result.fields.currency_values.join('; ')}"`,
          `dates,"${result.fields.dates.join('; ')}"`,
          `urls,"${result.fields.urls.join('; ')}"`,
          `possible_headings,"${result.fields.possible_headings.join('; ')}"`,
        ];
        blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = format === 'json' ? `${result.filename}-data.json` : `${result.filename}-fields.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not export data.');
    }
  };

  const downloadText = () => {
    if (!result) return;
    const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${result.filename.replace(/\.[^/.]+$/, '')}-extracted.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const isCurrentSaved = useMemo(() => {
    if (!result) return false;
    return savedDocs.some((d) => d.id === result.id || d.filename === result.filename);
  }, [result, savedDocs]);

  const totalFieldsCount = useMemo(() => {
    if (!result) return 0;
    return (
      result.fields.emails.length +
      result.fields.phone_numbers.length +
      result.fields.urls.length +
      result.fields.dates.length +
      result.fields.currency_values.length +
      result.fields.possible_headings.length
    );
  }, [result]);

  const filteredFields = useMemo(() => {
    if (!result) return null;
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      return {
        emails: result.fields.emails,
        phone_numbers: result.fields.phone_numbers,
        dates: result.fields.dates,
        currency_values: result.fields.currency_values,
        urls: result.fields.urls,
        possible_headings: result.fields.possible_headings,
      };
    }
    return {
      emails: result.fields.emails.filter((item) => item.toLowerCase().includes(q)),
      phone_numbers: result.fields.phone_numbers.filter((item) => item.toLowerCase().includes(q)),
      dates: result.fields.dates.filter((item) => item.toLowerCase().includes(q)),
      currency_values: result.fields.currency_values.filter((item) => item.toLowerCase().includes(q)),
      urls: result.fields.urls.filter((item) => item.toLowerCase().includes(q)),
      possible_headings: result.fields.possible_headings.filter((item) => item.toLowerCase().includes(q)),
    };
  }, [result, searchQuery]);

  return (
    <>
      <div className="ambient-bg-layer" />

      <main className="glass-dashboard-canvas">
        {/* Left Floating Sidebar */}
        <aside className="glass-sidebar">
          <div>
            <div className="brand-section">
              <div className="brand-logo-mark">
                <span style={{ fontWeight: 900, fontSize: '15px' }}>E</span>
              </div>
              <span className="brand-text">extract.ai</span>
            </div>

            <nav className="sidebar-nav">
              <button
                className={`sidebar-btn ${activeNav === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveNav('overview')}
              >
                <Activity size={17} />
                <span>Overview</span>
              </button>

              <button
                className={`sidebar-btn ${activeNav === 'fields' ? 'active' : ''}`}
                onClick={() => setActiveNav('fields')}
              >
                <FileSpreadsheet size={17} />
                <span>Fields</span>
                {result && totalFieldsCount > 0 && (
                  <span className="sidebar-count-badge">{totalFieldsCount}</span>
                )}
              </button>

              <button
                className={`sidebar-btn ${activeNav === 'text' ? 'active' : ''}`}
                onClick={() => setActiveNav('text')}
              >
                <Files size={17} />
                <span>Text OCR</span>
                {result && (
                  <span className="sidebar-count-badge">{result.fields.word_count}w</span>
                )}
              </button>

              <button
                className={`sidebar-btn ${activeNav === 'storage' ? 'active' : ''}`}
                onClick={() => setActiveNav('storage')}
              >
                <FolderArchive size={17} />
                <span>Saved Files</span>
                {savedDocs.length > 0 && (
                  <span className="sidebar-count-badge">{savedDocs.length}</span>
                )}
              </button>
            </nav>
          </div>

          <div className="sidebar-footer">
            <div className="storage-status-card">
              <strong>
                <Database size={13} /> Stored Documents
              </strong>
              <small>{savedDocs.length} extractions in storage</small>
            </div>
          </div>
        </aside>

        {/* Main Dashboard Section */}
        <section className="main-dashboard">
          {/* Top Bar */}
          <header className="top-nav-bar">
            <div className="top-nav-title-group">
              <h1 className="dashboard-heading">
                {activeNav === 'overview' && 'Document Intelligence'}
                {activeNav === 'fields' && 'Extracted Fields'}
                {activeNav === 'text' && 'Extracted Text & OCR'}
                {activeNav === 'storage' && 'Stored Documents'}
              </h1>
              <div className="dashboard-subheading">
                {result ? (
                  <>
                    <strong style={{ color: '#000000' }}>{result.filename}</strong> ·{' '}
                    <span>{result.file_type}</span> ·{' '}
                    <span>{formatBytes(result.size_bytes)}</span> ·{' '}
                    <span>{result.extraction_method}</span>
                  </>
                ) : file ? (
                  <>
                    <strong style={{ color: '#000000' }}>{file.name}</strong> ·{' '}
                    <span>{formatBytes(file.size)}</span> · Ready to extract
                  </>
                ) : (
                  <span>Upload a document to extract structured links, numbers, and sections</span>
                )}
              </div>
            </div>

            <div className="top-nav-actions">
              <button
                className="action-capsule-black"
                onClick={() => inputRef.current?.click()}
                title="Select a document"
              >
                <Plus size={15} />
                <span>Upload Document</span>
              </button>

              {result && (
                <button
                  className={`action-capsule-save ${isCurrentSaved ? 'saved' : ''}`}
                  onClick={saveCurrentDocument}
                  title="Store extraction to local history"
                >
                  {isCurrentSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                  <span>{isCurrentSaved ? 'Saved' : 'Save Extraction'}</span>
                </button>
              )}

              <div className="status-capsule-white">
                <span className="status-dot-green" />
                <span>{health === 'online' ? 'API Online' : 'Connecting'}</span>
              </div>

              <div className="search-capsule-white">
                <div className="search-icon-black-dot">
                  <Search size={13} />
                </div>
                <input
                  type="text"
                  placeholder="Search extracted fields..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {result && (
                <>
                  <button
                    className="action-capsule-save"
                    onClick={() => download('csv')}
                    title="Export CSV"
                  >
                    <Download size={13} />
                    <span>CSV</span>
                  </button>
                  <button
                    className="action-capsule-save"
                    onClick={() => download('json')}
                    title="Export JSON"
                  >
                    <Download size={13} />
                    <span>JSON</span>
                  </button>
                </>
              )}
            </div>
          </header>

          <input ref={inputRef} type="file" accept={ACCEPT} onChange={onInputChange} hidden />

          {error && (
            <div
              style={{
                background: '#fff2f2',
                border: '1px solid #ffd0d0',
                color: '#d32f2f',
                padding: '10px 16px',
                borderRadius: '14px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{error}</span>
              <button onClick={() => setError('')} style={{ color: '#d32f2f' }}>
                <X size={14} />
              </button>
            </div>
          )}

          {saveToast && (
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '8px 16px',
                borderRadius: 'var(--radius-pill)',
                fontSize: '11px',
                fontWeight: 600,
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
              }}
            >
              <Check size={14} color="#10b981" />
              <span>Document stored in Saved History!</span>
            </div>
          )}

          {/* VIEW: OVERVIEW DASHBOARD */}
          {activeNav === 'overview' && (
            <>
              {/* Top Row Grid */}
              <div className="dashboard-grid-top">
                {/* 1. Document Source & Parser Pipeline */}
                <div className="card-white pipeline-card">
                  <div className="pipeline-header">
                    <div className="source-status-badge">
                      <IconForFile name={result ? result.filename : file ? file.name : 'doc'} />
                      <span>{result ? result.filename : file ? file.name : 'Document Source'}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#888e9f' }}>
                      {result ? `Parsed via ${result.extraction_method}` : 'Ready for parsing'}
                    </span>
                  </div>

                  <div className="real-pipeline-metrics">
                    <div className="pipeline-metric-box">
                      <span>Parsed Lines</span>
                      <strong>{result ? result.fields.line_count.toLocaleString() : '0'}</strong>
                    </div>
                    <div className="pipeline-metric-box">
                      <span>Word Count</span>
                      <strong>{result ? result.fields.word_count.toLocaleString() : '0'}</strong>
                    </div>
                    <div className="pipeline-metric-box">
                      <span>Entities</span>
                      <strong>{totalFieldsCount}</strong>
                    </div>
                  </div>

                  {/* Interactive Upload / Change File Strip */}
                  <div
                    className="mini-dropzone-strip"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => inputRef.current?.click()}
                  >
                    <div className="mini-dropzone-info">
                      <div className="mini-dropzone-icon">
                        {file ? <IconForFile name={file.name} /> : <UploadCloud size={17} />}
                      </div>
                      <div className="mini-dropzone-copy">
                        <strong>
                          {file ? file.name : result ? 'Drop another document or browse' : 'Drop a document here or browse'}
                        </strong>
                        <span>
                          {file
                            ? `${formatBytes(file.size)} · Click Extract below`
                            : 'Supports PDF, Word (DOCX), Text, CSV, Excel & Images'}
                        </span>
                      </div>
                    </div>

                    <button
                      className="mini-extract-btn"
                      disabled={!file || busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        extract();
                      }}
                    >
                      {busy ? (
                        <>
                          <LoaderCircle className="spin" size={13} /> Extracting...
                        </>
                      ) : (
                        <>
                          <Activity size={13} /> Extract Data
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 2. Detected Fields Summary */}
                <div className="card-white metrics-card">
                  <div className="metrics-card-header">
                    <h3>Detected Fields</h3>
                    <span style={{ fontSize: '10px', color: '#888ea0', fontFamily: 'var(--font-mono)' }}>
                      HEURISTICS
                    </span>
                  </div>

                  <div className="metrics-big-stat">
                    <div className="metrics-stat-label">Total fields detected</div>
                    <div className="metrics-stat-value">{totalFieldsCount}</div>
                    <div className="metrics-stat-sub">
                      {result ? `${result.fields.emails.length + result.fields.phone_numbers.length} contacts & numbers` : 'No document extracted yet'}
                    </div>
                  </div>

                  <div className="real-field-breakdown-list">
                    <div className="real-field-breakdown-item">
                      <span>
                        <span className="stat-dot" /> Links & URLs
                      </span>
                      <strong>{result?.fields.urls.length || 0}</strong>
                    </div>
                    <div className="real-field-breakdown-item">
                      <span>
                        <span className="stat-dot" style={{ background: '#555' }} /> Phone Numbers
                      </span>
                      <strong>{result?.fields.phone_numbers.length || 0}</strong>
                    </div>
                    <div className="real-field-breakdown-item">
                      <span>
                        <span className="stat-dot" style={{ background: '#777' }} /> Currency Values
                      </span>
                      <strong>{result?.fields.currency_values.length || 0}</strong>
                    </div>
                    <div className="real-field-breakdown-item">
                      <span>
                        <span className="stat-dot" style={{ background: '#999' }} /> Section Headings
                      </span>
                      <strong>{result?.fields.possible_headings.length || 0}</strong>
                    </div>
                    <div className="real-field-breakdown-item">
                      <span>
                        <span className="stat-dot" style={{ background: '#bbb' }} /> Contact Emails
                      </span>
                      <strong>{result?.fields.emails.length || 0}</strong>
                    </div>
                  </div>
                </div>

                {/* 3. Document Inspector & Orb (Black Luxury Card) */}
                <div className="card-black preview-orb-card">
                  <div className="preview-orb-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Eye size={14} /> File Inspector
                    </span>
                    <span style={{ fontSize: '10px', color: '#888d9e', fontFamily: 'var(--font-mono)' }}>
                      {result ? result.file_type : 'STANDBY'}
                    </span>
                  </div>

                  <div className="orb-display-stage">
                    <img src="/liquid_chrome_orb.jpg" alt="Liquid Sphere" className="liquid-orb-image" />

                    <div className="orb-file-meta-overlay">
                      <div className="orb-file-name">
                        {result ? result.filename : file ? file.name : 'No file loaded'}
                      </div>
                      <div className="orb-file-caption">
                        {result
                          ? `${formatBytes(result.size_bytes)} · ${result.fields.word_count} words`
                          : file
                          ? `${formatBytes(file.size)} · Pending extraction`
                          : 'Drop a document to inspect'}
                      </div>
                    </div>
                  </div>

                  <div className="preview-orb-footer">
                    <span style={{ fontSize: '11px', color: '#a0a6b8' }}>
                      {result ? formatDate(result.extracted_at) : 'Local OCR engine'}
                    </span>

                    <button
                      className="orb-action-btn"
                      onClick={() => (result ? saveCurrentDocument() : inputRef.current?.click())}
                    >
                      {result ? (isCurrentSaved ? 'Saved in History' : 'Save Extraction') : 'Upload Document'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Row Grid */}
              <div className="dashboard-grid-bottom">
                {/* 1. Stored Documents & Storage History (The Storing Option!) */}
                <div className="card-white saved-docs-card">
                  <div className="saved-docs-header">
                    <div className="saved-docs-title-pill">
                      <div className="black-circle-icon">
                        <FolderArchive size={14} />
                      </div>
                      <span>Saved Documents</span>
                      <span style={{ fontSize: '11px', color: '#8d92a4' }}>({savedDocs.length})</span>
                    </div>

                    {savedDocs.length > 0 && (
                      <button className="clear-storage-btn" onClick={clearAllSavedDocs} title="Clear saved history">
                        Clear All
                      </button>
                    )}
                  </div>

                  {savedDocs.length > 0 ? (
                    <div className="saved-docs-list">
                      {savedDocs.map((doc) => {
                        const isSelected = result?.id === doc.id;
                        return (
                          <div
                            key={doc.id}
                            className={`saved-doc-item ${isSelected ? 'active-item' : ''}`}
                            onClick={() => {
                              setResult(doc);
                              setFile(null);
                            }}
                          >
                            <div className="saved-doc-left">
                              <IconForFile name={doc.filename} />
                              <span className="saved-doc-name">{doc.filename}</span>
                            </div>

                            <div className="saved-doc-actions">
                              <span className="saved-doc-count-tag">
                                {doc.fields.emails.length +
                                  doc.fields.phone_numbers.length +
                                  doc.fields.currency_values.length +
                                  doc.fields.urls.length}{' '}
                                fields
                              </span>

                              <button
                                className="saved-delete-btn"
                                onClick={(e) => deleteSavedDoc(doc.id, e)}
                                title="Remove from storage"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-saved-box">
                      <p>No extractions saved in storage yet.</p>
                      <span style={{ fontSize: '10px', color: '#888d9e' }}>
                        Load a sample file to test immediately:
                      </span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button
                          className="sample-load-chip-btn"
                          onClick={() => loadSampleFile('acme_corp_contract.txt', '/samples/acme_corp_contract.txt')}
                        >
                          Load Sample Contract
                        </button>
                        <button
                          className="sample-load-chip-btn"
                          onClick={() =>
                            loadSampleFile('quarterly_financials_2026.csv', '/samples/quarterly_financials_2026.csv')
                          }
                        >
                          Load Sample CSV
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Real Extracted Fields Stream (Links, Numbers, Sections, Contacts) */}
                <div className="card-black real-fields-hub-card">
                  <div className="dark-wave-texture-overlay" />

                  {/* Header Row */}
                  <div className="hub-top-header-row">
                    <div className="hub-badge-title">
                      <span>Extracted Fields Stream</span>
                      <span style={{ fontSize: '11px', color: '#8c93a8', fontFamily: 'var(--font-mono)' }}>
                        {result ? `${result.filename} (${totalFieldsCount} detected)` : 'Waiting for document'}
                      </span>
                    </div>

                    {result && (
                      <div className="hub-download-actions">
                        <button className="hub-action-btn-white" onClick={() => download('csv')}>
                          <ArrowDownToLine size={12} /> Export CSV
                        </button>
                        <button className="hub-action-btn-white" onClick={() => download('json')}>
                          <ArrowDownToLine size={12} /> Export JSON
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 4 Real Columns: Links, Numbers, Sections, Contacts */}
                  <div className="hub-four-columns-grid">
                    {/* Column 1: Links & Web URLs */}
                    <div className="hub-field-column">
                      <div className="hub-col-header">
                        <div className="hub-col-title">
                          <Globe size={13} />
                          <span>Links & URLs</span>
                        </div>
                        <span className="hub-col-count-pill">
                          {filteredFields?.urls.length ?? 0}
                        </span>
                      </div>

                      <div className="hub-col-items-list">
                        {filteredFields?.urls.length ? (
                          filteredFields.urls.map((url, idx) => (
                            <div className="hub-field-item-row" key={idx}>
                              <a href={url} target="_blank" rel="noreferrer" title={url}>
                                <ExternalLink size={10} style={{ display: 'inline', marginRight: '4px' }} />
                                {url}
                              </a>
                              <button
                                className={`hub-copy-btn ${copiedId === `u-${idx}` ? 'copied' : ''}`}
                                onClick={() => copyToClipboard(url, `u-${idx}`)}
                                title="Copy link"
                              >
                                {copiedId === `u-${idx}` ? <Check size={11} /> : <Copy size={11} />}
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="hub-empty-field-text">
                            {result ? 'No links found in document.' : 'No data.'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 2: Numbers & Currency */}
                    <div className="hub-field-column">
                      <div className="hub-col-header">
                        <div className="hub-col-title">
                          <Hash size={13} />
                          <span>Numbers & Currency</span>
                        </div>
                        <span className="hub-col-count-pill">
                          {(filteredFields?.phone_numbers.length ?? 0) +
                            (filteredFields?.currency_values.length ?? 0)}
                        </span>
                      </div>

                      <div className="hub-col-items-list">
                        {filteredFields &&
                        (filteredFields.phone_numbers.length > 0 ||
                          filteredFields.currency_values.length > 0) ? (
                          <>
                            {filteredFields.currency_values.map((curr, idx) => (
                              <div className="hub-field-item-row" key={`curr-${idx}`}>
                                <strong style={{ color: '#ffffff' }}>{curr}</strong>
                                <button
                                  className={`hub-copy-btn ${copiedId === `curr-${idx}` ? 'copied' : ''}`}
                                  onClick={() => copyToClipboard(curr, `curr-${idx}`)}
                                  title="Copy value"
                                >
                                  {copiedId === `curr-${idx}` ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                              </div>
                            ))}
                            {filteredFields.phone_numbers.map((phone, idx) => (
                              <div className="hub-field-item-row" key={`ph-${idx}`}>
                                <a href={`tel:${phone}`} style={{ textDecoration: 'none' }}>
                                  {phone}
                                </a>
                                <button
                                  className={`hub-copy-btn ${copiedId === `ph-${idx}` ? 'copied' : ''}`}
                                  onClick={() => copyToClipboard(phone, `ph-${idx}`)}
                                  title="Copy phone"
                                >
                                  {copiedId === `ph-${idx}` ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="hub-empty-field-text">
                            {result ? 'No numbers found.' : 'No data.'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 3: Sections & Headings */}
                    <div className="hub-field-column">
                      <div className="hub-col-header">
                        <div className="hub-col-title">
                          <Heading size={13} />
                          <span>Sections & Headings</span>
                        </div>
                        <span className="hub-col-count-pill">
                          {filteredFields?.possible_headings.length ?? 0}
                        </span>
                      </div>

                      <div className="hub-col-items-list">
                        {filteredFields?.possible_headings.length ? (
                          filteredFields.possible_headings.map((h, idx) => (
                            <div className="hub-field-item-row" key={idx}>
                              <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {h}
                              </span>
                              <button
                                className={`hub-copy-btn ${copiedId === `h-${idx}` ? 'copied' : ''}`}
                                onClick={() => copyToClipboard(h, `h-${idx}`)}
                                title="Copy heading"
                              >
                                {copiedId === `h-${idx}` ? <Check size={11} /> : <Copy size={11} />}
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="hub-empty-field-text">
                            {result ? 'No sections found.' : 'No data.'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 4: Contact Emails & Dates */}
                    <div className="hub-field-column">
                      <div className="hub-col-header">
                        <div className="hub-col-title">
                          <Mail size={13} />
                          <span>Contacts & Dates</span>
                        </div>
                        <span className="hub-col-count-pill">
                          {(filteredFields?.emails.length ?? 0) + (filteredFields?.dates.length ?? 0)}
                        </span>
                      </div>

                      <div className="hub-col-items-list">
                        {filteredFields &&
                        (filteredFields.emails.length > 0 || filteredFields.dates.length > 0) ? (
                          <>
                            {filteredFields.emails.map((e, idx) => (
                              <div className="hub-field-item-row" key={`em-${idx}`}>
                                <a href={`mailto:${e}`} style={{ textDecoration: 'none' }}>
                                  {e}
                                </a>
                                <button
                                  className={`hub-copy-btn ${copiedId === `em-${idx}` ? 'copied' : ''}`}
                                  onClick={() => copyToClipboard(e, `em-${idx}`)}
                                  title="Copy email"
                                >
                                  {copiedId === `em-${idx}` ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                              </div>
                            ))}
                            {filteredFields.dates.map((d, idx) => (
                              <div className="hub-field-item-row" key={`dt-${idx}`}>
                                <span style={{ color: '#ffffff' }}>{d}</span>
                                <button
                                  className={`hub-copy-btn ${copiedId === `dt-${idx}` ? 'copied' : ''}`}
                                  onClick={() => copyToClipboard(d, `dt-${idx}`)}
                                  title="Copy date"
                                >
                                  {copiedId === `dt-${idx}` ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="hub-empty-field-text">
                            {result ? 'No emails or dates found.' : 'No data.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* VIEW: FIELDS DEEP-DIVE */}
          {activeNav === 'fields' && (
            <div className="dedicated-white-panel">
              <div className="dedicated-view-header">
                <div>
                  <h2>All Extracted Fields</h2>
                  <span style={{ fontSize: '12px', color: '#687082' }}>
                    Real links, numbers, currency values, section headings, and contact emails extracted from {result?.filename || 'your document'}.
                  </span>
                </div>

                <div className="dedicated-toolbar-actions">
                  <button className="dedicated-pill-btn" onClick={() => download('csv')}>
                    <Download size={14} /> Export CSV
                  </button>
                  <button className="dedicated-pill-btn" onClick={() => download('json')}>
                    <Download size={14} /> Export JSON
                  </button>
                </div>
              </div>

              {result ? (
                <div className="fields-chic-grid">
                  {/* Links */}
                  <div className="field-chic-card">
                    <div className="field-chic-header">
                      <div className="field-chic-title">
                        <Globe size={15} /> Links & Web URLs
                      </div>
                      <span className="field-chic-badge">{filteredFields?.urls.length ?? 0}</span>
                    </div>
                    <div className="field-chic-items">
                      {filteredFields?.urls.length ? (
                        filteredFields.urls.map((url, idx) => (
                          <div className="field-chic-row" key={idx}>
                            <a href={url} target="_blank" rel="noreferrer" style={{ color: '#000', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <ExternalLink size={11} /> {url}
                            </a>
                            <button
                              className={`field-copy-icon-btn ${copiedId === `uf-${idx}` ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(url, `uf-${idx}`)}
                            >
                              {copiedId === `uf-${idx}` ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: '#8d92a4', fontStyle: 'italic' }}>
                          No URLs detected in this document.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Phone Numbers */}
                  <div className="field-chic-card">
                    <div className="field-chic-header">
                      <div className="field-chic-title">
                        <Phone size={15} /> Phone Numbers
                      </div>
                      <span className="field-chic-badge">{filteredFields?.phone_numbers.length ?? 0}</span>
                    </div>
                    <div className="field-chic-items">
                      {filteredFields?.phone_numbers.length ? (
                        filteredFields.phone_numbers.map((phone, idx) => (
                          <div className="field-chic-row" key={idx}>
                            <a href={`tel:${phone}`} style={{ color: '#000', textDecoration: 'none' }}>
                              {phone}
                            </a>
                            <button
                              className={`field-copy-icon-btn ${copiedId === `pf-${idx}` ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(phone, `pf-${idx}`)}
                            >
                              {copiedId === `pf-${idx}` ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: '#8d92a4', fontStyle: 'italic' }}>
                          No phone numbers detected.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Currency Values */}
                  <div className="field-chic-card">
                    <div className="field-chic-header">
                      <div className="field-chic-title">
                        <DollarSign size={15} /> Currency & Monetary Figures
                      </div>
                      <span className="field-chic-badge">{filteredFields?.currency_values.length ?? 0}</span>
                    </div>
                    <div className="field-chic-items">
                      {filteredFields?.currency_values.length ? (
                        filteredFields.currency_values.map((c, idx) => (
                          <div className="field-chic-row" key={idx}>
                            <strong style={{ color: '#000000' }}>{c}</strong>
                            <button
                              className={`field-copy-icon-btn ${copiedId === `cf-${idx}` ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(c, `cf-${idx}`)}
                            >
                              {copiedId === `cf-${idx}` ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: '#8d92a4', fontStyle: 'italic' }}>
                          No currency values detected.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Sections & Headings */}
                  <div className="field-chic-card">
                    <div className="field-chic-header">
                      <div className="field-chic-title">
                        <Heading size={15} /> Document Sections & Headings
                      </div>
                      <span className="field-chic-badge">{filteredFields?.possible_headings.length ?? 0}</span>
                    </div>
                    <div className="field-chic-items">
                      {filteredFields?.possible_headings.length ? (
                        filteredFields.possible_headings.map((h, idx) => (
                          <div className="field-chic-row" key={idx}>
                            <span>{h}</span>
                            <button
                              className={`field-copy-icon-btn ${copiedId === `hf-${idx}` ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(h, `hf-${idx}`)}
                            >
                              {copiedId === `hf-${idx}` ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: '#8d92a4', fontStyle: 'italic' }}>
                          No section headings detected.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Contact Emails */}
                  <div className="field-chic-card">
                    <div className="field-chic-header">
                      <div className="field-chic-title">
                        <Mail size={15} /> Contact Email Addresses
                      </div>
                      <span className="field-chic-badge">{filteredFields?.emails.length ?? 0}</span>
                    </div>
                    <div className="field-chic-items">
                      {filteredFields?.emails.length ? (
                        filteredFields.emails.map((e, idx) => (
                          <div className="field-chic-row" key={idx}>
                            <a href={`mailto:${e}`} style={{ color: '#000', textDecoration: 'none' }}>
                              {e}
                            </a>
                            <button
                              className={`field-copy-icon-btn ${copiedId === `ef-${idx}` ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(e, `ef-${idx}`)}
                            >
                              {copiedId === `ef-${idx}` ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: '#8d92a4', fontStyle: 'italic' }}>
                          No email addresses detected.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="field-chic-card">
                    <div className="field-chic-header">
                      <div className="field-chic-title">
                        <Clock3 size={15} /> Dates & Timestamps
                      </div>
                      <span className="field-chic-badge">{filteredFields?.dates.length ?? 0}</span>
                    </div>
                    <div className="field-chic-items">
                      {filteredFields?.dates.length ? (
                        filteredFields.dates.map((d, idx) => (
                          <div className="field-chic-row" key={idx}>
                            <span>{d}</span>
                            <button
                              className={`field-copy-icon-btn ${copiedId === `df-${idx}` ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(d, `df-${idx}`)}
                            >
                              {copiedId === `df-${idx}` ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: '#8d92a4', fontStyle: 'italic' }}>
                          No dates detected.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', background: '#fafbfe', borderRadius: '16px' }}>
                  <p style={{ fontSize: '13px', color: '#687082', marginBottom: '12px' }}>
                    No document has been extracted yet.
                  </p>
                  <button className="action-capsule-black" onClick={() => inputRef.current?.click()}>
                    <UploadCloud size={14} /> Upload Document
                  </button>
                </div>
              )}
            </div>
          )}

          {/* VIEW: TEXT OCR READER */}
          {activeNav === 'text' && (
            <div className="dedicated-white-panel">
              <div className="dedicated-view-header">
                <div>
                  <h2>Extracted Text Stream</h2>
                  <span style={{ fontSize: '12px', color: '#687082' }}>
                    Full text stream parsed directly by PyMuPDF or Tesseract OCR.
                  </span>
                </div>

                <div className="dedicated-toolbar-actions">
                  <button
                    className="dedicated-pill-btn"
                    onClick={() => result && copyToClipboard(result.text, 'text-body')}
                  >
                    {copiedId === 'text-body' ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                    <span>{copiedId === 'text-body' ? 'Copied' : 'Copy Text'}</span>
                  </button>
                  <button className="dedicated-pill-btn" onClick={downloadText}>
                    <Download size={14} /> Download .txt
                  </button>
                </div>
              </div>

              {result ? (
                <div className="text-reader-chic">
                  <div className="text-reader-chic-header">
                    <span>File: {result.filename}</span>
                    <span>Words: {result.fields.word_count.toLocaleString()}</span>
                    <span>Lines: {result.fields.line_count.toLocaleString()}</span>
                    <span>Method: {result.extraction_method}</span>
                  </div>
                  <pre className="text-reader-chic-body">{result.text}</pre>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', background: '#fafbfe', borderRadius: '16px' }}>
                  <p style={{ fontSize: '13px', color: '#687082', marginBottom: '12px' }}>
                    No document text available. Upload a file to read its contents.
                  </p>
                  <button className="action-capsule-black" onClick={() => inputRef.current?.click()}>
                    <UploadCloud size={14} /> Upload Document
                  </button>
                </div>
              )}
            </div>
          )}

          {/* VIEW: STORAGE HISTORY (The Storing Option!) */}
          {activeNav === 'storage' && (
            <div className="dedicated-white-panel">
              <div className="dedicated-view-header">
                <div>
                  <h2>Saved Extractions Storage</h2>
                  <span style={{ fontSize: '12px', color: '#687082' }}>
                    Manage and reload all previously parsed documents stored locally in your browser session.
                  </span>
                </div>

                {savedDocs.length > 0 && (
                  <div className="dedicated-toolbar-actions">
                    <button className="dedicated-pill-btn" onClick={clearAllSavedDocs}>
                      <Trash2 size={14} /> Clear Storage
                    </button>
                  </div>
                )}
              </div>

              {savedDocs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {savedDocs.map((doc) => (
                    <div
                      key={doc.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 18px',
                        background: '#f8f9fc',
                        borderRadius: '14px',
                        border: '1px solid #e7eaf2',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <IconForFile name={doc.filename} />
                        <div>
                          <strong style={{ fontSize: '13px', color: '#000000', display: 'block' }}>
                            {doc.filename}
                          </strong>
                          <span style={{ fontSize: '11px', color: '#848a9b' }}>
                            {formatBytes(doc.size_bytes)} · {doc.extraction_method} · Saved{' '}
                            {formatDate(doc.savedAt)}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          className="dedicated-pill-btn primary"
                          style={{ height: '32px' }}
                          onClick={() => {
                            setResult(doc);
                            setActiveNav('overview');
                          }}
                        >
                          View in Dashboard
                        </button>
                        <button
                          className="saved-delete-btn"
                          style={{ padding: '6px' }}
                          onClick={(e) => deleteSavedDoc(doc.id, e)}
                          title="Delete from storage"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', background: '#fafbfe', borderRadius: '16px' }}>
                  <p style={{ fontSize: '13px', color: '#687082', marginBottom: '12px' }}>
                    No documents currently stored in browser history.
                  </p>
                  <button className="action-capsule-black" onClick={() => inputRef.current?.click()}>
                    <UploadCloud size={14} /> Upload & Extract Document
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
