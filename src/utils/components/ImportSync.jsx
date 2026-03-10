// src/components/ImportSync.jsx
// Import and sync UI for both card collections and decks.
// Accepts drag-and-drop files or pasted text.
// Connects to collectionSync.js and deckSync.js for Firestore writes.

import { useState, useRef, useCallback } from 'react';
import { syncCollection, getCollectionMeta } from '../utils/collectionSync';
import { syncDeck } from '../utils/deckSync';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const IMPORT_TYPES = {
  collection: {
    label: 'Collection',
    icon: '📦',
    description: 'Your owned cards from Moxfield, Manabox, Archidekt, or a plain list',
    accept: '.csv,.txt',
  },
  deck: {
    label: 'Deck',
    icon: '🃏',
    description: 'A single decklist from any supported format',
    accept: '.csv,.txt,.dec',
  },
};

const SOURCES = ['Moxfield', 'Archidekt', 'Manabox', 'MTGGoldfish', 'Plain text'];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusPill({ status }) {
  if (!status) return null;
  const styles = {
    success: { bg: '#052e16', border: '#166534', text: '#4ade80', icon: '✓' },
    error:   { bg: '#2d0a0a', border: '#7f1d1d', text: '#f87171', icon: '✕' },
    loading: { bg: '#0c1a3a', border: '#1e3a8a', text: '#93c5fd', icon: '…' },
  };
  const s = styles[status.type] ?? styles.loading;
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8,
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 13, color: s.text, marginTop: 14,
    }}>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{s.icon}</span>
      <span>{status.message}</span>
    </div>
  );
}

function ProgressBar({ phase, pct }) {
  if (!phase || phase === 'done') return null;
  const labels = { parsing: 'Parsing…', syncing: 'Syncing to cloud…', indexing: 'Indexing…' };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: '#64748b' }}>{labels[phase] ?? phase}</span>
        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{pct}%</span>
      </div>
      <div style={{ height: 3, background: '#1e2030', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: '#3b82f6',
          borderRadius: 2, transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

function MetaBadge({ meta }) {
  if (!meta?.lastSyncedAt) return null;
  const ago = formatAgo(meta.lastSyncedAt);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#475569' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
      Last synced {ago} · {meta.cardCount?.toLocaleString()} cards
      {meta.source && <span style={{ color: '#334155' }}>· via {meta.source}</span>}
    </div>
  );
}

function formatAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Drop zone
// ---------------------------------------------------------------------------
function DropZone({ onText, isDragging, setIsDragging }) {
  const fileInputRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file, onText);
  }, [onText, setIsDragging]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) readFile(file, onText);
  };

  function readFile(file, cb) {
    const reader = new FileReader();
    reader.onload = (e) => cb(e.target.result);
    reader.readAsText(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      style={{
        border: `2px dashed ${isDragging ? '#3b82f6' : '#2a2d45'}`,
        borderRadius: 10,
        padding: '22px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        background: isDragging ? '#0c1a3a' : '#0d0f1e',
        transition: 'all 0.15s ease',
        marginBottom: 14,
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>⬆</div>
      <div style={{ fontSize: 13, color: '#64748b' }}>
        Drop a file or <span style={{ color: '#3b82f6', textDecoration: 'underline' }}>click to browse</span>
      </div>
      <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
        CSV, TXT, or plain decklist
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.dec"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ImportSync({ onCollectionUpdated, onDeckImported }) {
  const [activeType, setActiveType] = useState('collection');
  const [rawText, setRawText] = useState('');
  const [mergeMode, setMergeMode] = useState('merge');
  const [deckName, setDeckName] = useState('');
  const [deckFormat, setDeckFormat] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState(null);
  const [collectionMeta, setCollectionMeta] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load collection meta on mount
  useState(() => {
    getCollectionMeta().then(setCollectionMeta).catch(() => {});
  });

  const handleSubmit = async () => {
    if (!rawText.trim()) {
      setStatus({ type: 'error', message: 'Paste or drop some card data first.' });
      return;
    }
    setIsSubmitting(true);
    setStatus(null);
    setProgress(null);

    try {
      if (activeType === 'collection') {
        const result = await syncCollection({
          rawText,
          mode: mergeMode,
          onProgress: setProgress,
        });
        setStatus({
          type: 'success',
          message: `${result.mode === 'merge' ? 'Merged' : 'Replaced'} collection — ${result.cardCount.toLocaleString()} cards synced from ${result.source}.`,
        });
        const meta = await getCollectionMeta();
        setCollectionMeta(meta);
        onCollectionUpdated?.();
      } else {
        const result = await syncDeck({
          rawText,
          deckName: deckName || undefined,
          format: deckFormat || undefined,
          onProgress: setProgress,
        });
        setStatus({
          type: 'success',
          message: `${result.isUpdate ? 'Updated' : 'Imported'} "${result.name}" — ${result.cardCount} cards from ${result.source}.`,
        });
        onDeckImported?.();
      }
      setRawText('');
      setDeckName('');
    } catch (err) {
      setStatus({ type: 'error', message: err.message ?? 'Something went wrong.' });
    } finally {
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  const typeConfig = IMPORT_TYPES[activeType];

  return (
    <div style={{
      background: '#0a0b14',
      minHeight: '100vh',
      padding: 24,
      fontFamily: '"DM Sans", system-ui, sans-serif',
      color: '#e2e8f0',
      display: 'flex',
      justifyContent: 'center',
    }}>
      <style>{`
        textarea::placeholder { color: #334155; }
        textarea:focus { outline: none; border-color: #3b82f6 !important; }
        input:focus { outline: none; border-color: #3b82f6 !important; }
        select:focus { outline: none; }
      `}</style>

      <div style={{ width: '100%', maxWidth: 580 }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: '#f1f5f9', letterSpacing: -0.5 }}>
            Import & Sync
          </h1>
          <p style={{ fontSize: 13, color: '#475569', margin: '5px 0 0' }}>
            Supported sources: {SOURCES.join(', ')}
          </p>
        </div>

        {/* Type toggle */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 10, marginBottom: 20,
        }}>
          {Object.entries(IMPORT_TYPES).map(([type, cfg]) => (
            <button
              key={type}
              onClick={() => { setActiveType(type); setStatus(null); }}
              style={{
                background: activeType === type ? '#16182a' : '#0d0f1e',
                border: `1px solid ${activeType === type ? '#3b4070' : '#1e2030'}`,
                borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                textAlign: 'left', transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 5 }}>{cfg.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>
                {cfg.label}
              </div>
              <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
                {cfg.description}
              </div>
            </button>
          ))}
        </div>

        {/* Main card */}
        <div style={{
          background: '#111320', border: '1px solid #1e2030',
          borderRadius: 14, padding: 22,
        }}>

          {/* Collection-specific: meta + merge toggle */}
          {activeType === 'collection' && (
            <div style={{ marginBottom: 16 }}>
              <MetaBadge meta={collectionMeta} />
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginTop: collectionMeta?.lastSyncedAt ? 14 : 0,
                padding: '10px 14px',
                background: '#0d0f1e', borderRadius: 8, border: '1px solid #1e2030',
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Sync mode</div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                    {mergeMode === 'merge'
                      ? 'Adds imported quantities to your existing collection'
                      : 'Replaces your entire collection with this import'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['merge', 'replace'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setMergeMode(m)}
                      style={{
                        background: mergeMode === m ? (m === 'replace' ? '#450a0a' : '#052e16') : 'transparent',
                        border: `1px solid ${mergeMode === m ? (m === 'replace' ? '#7f1d1d' : '#166534') : '#2a2d45'}`,
                        color: mergeMode === m ? (m === 'replace' ? '#f87171' : '#4ade80') : '#475569',
                        borderRadius: 6, padding: '5px 12px', fontSize: 11,
                        fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                        transition: 'all 0.15s',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Deck-specific: name + format */}
          {activeType === 'deck' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 16 }}>
              <input
                type="text"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Deck name (optional — auto-detected)"
                style={{
                  background: '#0d0f1e', border: '1px solid #2a2d45',
                  borderRadius: 8, padding: '9px 12px', fontSize: 13,
                  color: '#e2e8f0', width: '100%', boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
              />
              <select
                value={deckFormat}
                onChange={(e) => setDeckFormat(e.target.value)}
                style={{
                  background: '#0d0f1e', border: '1px solid #2a2d45',
                  borderRadius: 8, padding: '9px 12px', fontSize: 13,
                  color: deckFormat ? '#e2e8f0' : '#475569', cursor: 'pointer',
                }}
              >
                <option value="">Format…</option>
                <option value="commander">Commander</option>
                <option value="standard">Standard</option>
                <option value="modern">Modern</option>
                <option value="pioneer">Pioneer</option>
                <option value="legacy">Legacy</option>
                <option value="vintage">Vintage</option>
                <option value="pauper">Pauper</option>
              </select>
            </div>
          )}

          {/* Drop zone */}
          <DropZone
            onText={(text) => { setRawText(text); setStatus(null); }}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
          />

          {/* Paste area */}
          <textarea
            value={rawText}
            onChange={(e) => { setRawText(e.target.value); setStatus(null); }}
            placeholder={`Paste your ${activeType === 'collection' ? 'collection export' : 'decklist'} here…\n\nExample:\n4 Lightning Bolt\n4 Monastery Swiftspear\n2 Goblin Guide`}
            rows={8}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0d0f1e', border: '1px solid #2a2d45',
              borderRadius: 8, padding: '12px 14px', fontSize: 12,
              color: '#94a3b8', resize: 'vertical', fontFamily: 'monospace',
              lineHeight: 1.7, transition: 'border-color 0.15s',
            }}
          />

          {/* Progress */}
          <ProgressBar phase={progress?.phase} pct={progress?.pct ?? 0} />

          {/* Status */}
          <StatusPill status={status} />

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !rawText.trim()}
            style={{
              marginTop: 16, width: '100%',
              background: isSubmitting || !rawText.trim() ? '#1e2030' : '#2563eb',
              color: isSubmitting || !rawText.trim() ? '#475569' : '#fff',
              border: 'none', borderRadius: 8, padding: '12px 0',
              fontSize: 14, fontWeight: 700, cursor: isSubmitting || !rawText.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s', letterSpacing: 0.3,
            }}
          >
            {isSubmitting
              ? (progress?.phase === 'parsing' ? 'Parsing…' : 'Syncing…')
              : `Sync ${typeConfig.label}`}
          </button>
        </div>

      </div>
    </div>
  );
}
