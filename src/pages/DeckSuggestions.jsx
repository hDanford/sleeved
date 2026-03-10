// src/pages/DeckSuggestions.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { generateSuggestions, rescore } from '../utils/deckSuggestions';
import { DEFAULT_WEIGHTS, SCORE_META } from '../utils/deckScoring';
import { useAuth } from '../App';
import { loadCollection } from '../utils/collectionStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSourceUrl(deck) {
  if (deck.source === 'EDHREC') {
    const slug = deck.id.replace(/^edhrec-/, '');
    return `https://edhrec.com/commanders/${slug}`;
  }
  if (deck.source === 'MTGGoldfish') {
    // e.g. "mtgg-4-color-omnath" → "4-color-omnath"
    const slug = deck.id.replace(/^mtgg-/, '');
    return `https://www.mtggoldfish.com/archetype/${slug}`;
  }
  return null;
}

const SECTION_ORDER = ['commander', 'mainboard', 'land', 'sideboard'];
const SECTION_LABELS = {
  commander: 'Commander',
  mainboard: 'Mainboard',
  land: 'Lands',
  sideboard: 'Sideboard',
};

// ---------------------------------------------------------------------------
// Score ring
// ---------------------------------------------------------------------------
function ScoreRing({ score, size = 72 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a3a" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size * 0.22} fontWeight="700"
        style={{ transform: 'rotate(90deg)', transformOrigin: `${size / 2}px ${size / 2}px`, fontFamily: 'monospace' }}>
        {Math.round(score)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-score bar
// ---------------------------------------------------------------------------
function SubScoreBar({ label, score, color, icon }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{icon}</span>{label}
        </span>
        <span style={{ fontSize: 11, color, fontWeight: 700, fontFamily: 'monospace' }}>
          {Math.round(score)}
        </span>
      </div>
      <div style={{ height: 4, background: '#1e2030', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${score}%`, background: color, borderRadius: 2,
          transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)', boxShadow: `0 0 6px ${color}55`,
        }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab — scores + missing cards
// ---------------------------------------------------------------------------
function OverviewTab({ deck }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', marginBottom: 16 }}>
        {Object.entries(SCORE_META).map(([key, meta]) => (
          <SubScoreBar key={key} label={meta.label} score={deck.subscores[key] ?? 0}
            color={meta.color} icon={meta.icon} />
        ))}
      </div>

      {deck.missingCards?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Cards to Acquire ({deck.missingCards.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {deck.missingCards.map((c) => (
              <span key={c.name} style={{
                background: '#1a1c2e', border: '1px solid #2a2d45', borderRadius: 6,
                padding: '3px 9px', fontSize: 11, color: '#94a3b8',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ color: '#64748b' }}>{c.quantity}×</span>
                {c.name}
                {c.price_usd > 0 && (
                  <span style={{ color: '#f59e0b', fontFamily: 'monospace' }}>
                    ${(c.price_usd * c.quantity).toFixed(2)}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {(!deck.missingCards || deck.missingCards.length === 0) && (
        <div style={{ fontSize: 12, color: '#22c55e', padding: '8px 12px', background: 'rgba(34,197,94,0.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)' }}>
          ✓ You own all the key cards for this deck!
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Deck tab — complete list grouped by section + source link
// ---------------------------------------------------------------------------
function FullDeckTab({ deck }) {
  const sourceUrl = getSourceUrl(deck);

  // Group cards by section
  const grouped = {};
  for (const card of deck.keyCards ?? []) {
    const sec = card.section ?? 'mainboard';
    if (!grouped[sec]) grouped[sec] = [];
    grouped[sec].push(card);
  }

  const missingNames = new Set((deck.missingCards ?? []).map((c) => c.name.toLowerCase()));
  const totalCards = (deck.keyCards ?? []).reduce((s, c) => s + (c.quantity ?? 1), 0);

  return (
    <div>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Cards', value: totalCards },
          { label: 'You Own', value: totalCards - (deck.missingCards?.reduce((s, c) => s + (c.quantity ?? 1), 0) ?? 0) },
          { label: 'To Acquire', value: deck.missingCards?.length ?? 0 },
          { label: 'Est. Cost', value: `$${deck.totalCost?.toFixed(2) ?? '0.00'}` },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#0f1020', border: '1px solid #1e2030', borderRadius: 8, padding: '8px 14px', minWidth: 90 }}>
            <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Card sections */}
      {SECTION_ORDER.filter((sec) => grouped[sec]?.length > 0).map((sec) => (
        <div key={sec} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            {SECTION_LABELS[sec]}
            <span style={{ color: '#334155', fontWeight: 400 }}>({grouped[sec].length})</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 8px' }}>
            {grouped[sec].map((card) => {
              const missing = missingNames.has(card.name.toLowerCase());
              return (
                <div key={card.name} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 8px', borderRadius: 6,
                  background: missing ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.04)',
                  border: `1px solid ${missing ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.1)'}`,
                }}>
                  <span style={{
                    fontSize: 11, fontFamily: 'monospace', fontWeight: 700, minWidth: 22, textAlign: 'right',
                    color: missing ? '#ef4444' : '#22c55e',
                  }}>
                    {card.quantity ?? 1}×
                  </span>
                  <span style={{ fontSize: 12, color: missing ? '#94a3b8' : '#cbd5e1', flex: 1 }}>
                    {card.name}
                  </span>
                  {missing && (
                    <span style={{ fontSize: 9, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                      NEED
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Source link */}
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8,
            padding: '9px 16px', borderRadius: 8,
            background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.3)',
            color: '#93c5fd', fontSize: 13, fontWeight: 600, textDecoration: 'none',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(37,99,235,0.2)'; e.currentTarget.style.borderColor = 'rgba(37,99,235,0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(37,99,235,0.1)'; e.currentTarget.style.borderColor = 'rgba(37,99,235,0.3)'; }}
        >
          View on {deck.source} ↗
        </a>
      ) : (
        <div style={{ fontSize: 11, color: '#334155', marginTop: 8 }}>
          Source: {deck.source} (no direct link available)
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single deck card
// ---------------------------------------------------------------------------
function DeckCard({ deck, rank, isExpanded, onToggle }) {
  const [activeTab, setActiveTab] = useState('overview');

  const colorEmoji = { W: '☀', U: '💧', B: '💀', R: '🔥', G: '🌿' };
  const rankColor = rank === 1 ? '#fbbf24' : rank === 2 ? '#94a3b8' : rank === 3 ? '#cd7f32' : '#475569';

  // Reset to overview tab when card is collapsed
  useEffect(() => {
    if (!isExpanded) setActiveTab('overview');
  }, [isExpanded]);

  return (
    <div
      onClick={onToggle}
      style={{
        background: isExpanded ? '#16182a' : '#111320',
        border: `1px solid ${isExpanded ? '#3b4070' : '#1e2030'}`,
        borderRadius: 12,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b4070'; e.currentTarget.style.background = '#16182a'; }}
      onMouseLeave={(e) => { if (!isExpanded) { e.currentTarget.style.borderColor = '#1e2030'; e.currentTarget.style.background = '#111320'; } }}
    >
      {/* Rank badge */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        background: rankColor, color: '#000',
        fontSize: 10, fontWeight: 800, padding: '3px 10px 3px 8px',
        borderBottomRightRadius: 8, letterSpacing: 1, fontFamily: 'monospace',
      }}>#{rank}</div>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        <ScoreRing score={deck.mainScore} size={72} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
            {deck.name}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
            {deck.colors.map((c) => (
              <span key={c} style={{ background: '#1e2030', color: '#94a3b8', fontSize: 13, padding: '1px 6px', borderRadius: 4 }}>
                {colorEmoji[c] ?? c}
              </span>
            ))}
            <span style={{ background: '#1e2030', color: '#64748b', fontSize: 10, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {deck.strategy}
            </span>
            <span style={{ background: '#1e2030', color: '#64748b', fontSize: 10, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {deck.format}
            </span>
            <span style={{ background: '#1a1c2e', color: '#475569', fontSize: 10, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5 }}>
              {deck.source}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{deck.description}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            <span style={{ color: '#22c55e', fontWeight: 700 }}>${deck.totalCost?.toFixed(2) ?? '—'}</span> to complete
          </div>
          <div style={{ fontSize: 11, color: '#475569' }}>{deck.missingCards?.length ?? 0} cards needed</div>
          <div style={{ fontSize: 18, color: '#475569', marginTop: 2, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>⌄</div>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #1e2030', animation: 'fadeIn 0.2s ease' }}>
          {/* Tabs */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#0f1020', borderRadius: 8, padding: 4, width: 'fit-content' }}
          >
            {[
              { id: 'overview', label: '📊 Overview' },
              { id: 'fulldeck', label: '📋 Full Deck' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={(e) => { e.stopPropagation(); setActiveTab(tab.id); }}
                style={{
                  background: activeTab === tab.id ? '#1e2235' : 'transparent',
                  border: activeTab === tab.id ? '1px solid #3b4070' : '1px solid transparent',
                  color: activeTab === tab.id ? '#e2e8f0' : '#475569',
                  borderRadius: 6, padding: '6px 14px', fontSize: 12,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div onClick={(e) => e.stopPropagation()}>
            {activeTab === 'overview' && <OverviewTab deck={deck} />}
            {activeTab === 'fulldeck' && <FullDeckTab deck={deck} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weight slider
// ---------------------------------------------------------------------------
function WeightSlider({ metaKey, value, onChange }) {
  const meta = SCORE_META[metaKey];
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span>{meta.icon}</span>{meta.label}
        </span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: meta.color, fontWeight: 700 }}>
          {value.toFixed(1)}×
        </span>
      </div>
      <input type="range" min={0} max={2} step={0.1} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: meta.color, height: 4, cursor: 'pointer' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
const ALL_FORMATS = ['commander', 'standard', 'modern', 'pioneer'];
const ALL_COLORS  = ['W', 'U', 'B', 'R', 'G'];
const COLOR_META  = { W: { emoji: '☀', label: 'White' }, U: { emoji: '💧', label: 'Blue' }, B: { emoji: '💀', label: 'Black' }, R: { emoji: '🔥', label: 'Red' }, G: { emoji: '🌿', label: 'Green' } };

export default function DeckSuggestions() {
  const { user } = useAuth();
  const [userCollection, setUserCollection] = useState(new Map());
  const [suggestions, setSuggestions] = useState([]);
  const [displayedSuggestions, setDisplayedSuggestions] = useState([]);
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS });
  const [selectedFormats, setSelectedFormats] = useState([...ALL_FORMATS]);
  const [colorFilter, setColorFilter] = useState([]); // empty = no filter
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ phase: null, pct: 0, label: null, current: 0, total: 0 });
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState(null);

  // Load collection into a Map<nameLower, qty> for scoring
  useEffect(() => {
    if (!user) return;
    loadCollection(user.uid).then((cards) => {
      const map = new Map();
      for (const c of cards) map.set(c.name.toLowerCase(), c.quantity ?? 1);
      setUserCollection(map);
    });
  }, [user]);

  const fetchSuggestions = useCallback(async () => {
    if (loading || !selectedFormats.length) return;
    setLoading(true);
    setError(null);
    try {
      const results = await generateSuggestions({
        userCollection,
        userDeckProfiles: [],
        weights,
        formats: selectedFormats,
        colorFilter,
        onProgress: (p) => setProgress(typeof p === 'object' ? p : { current: p, total: arguments[1] }),
      });
      setSuggestions(results);
    } catch (e) {
      setError(e.message?.includes('fetch') || e.message?.includes('storage')
        ? 'Deck database not yet available. Run the sync workflow in GitHub Actions first, then try again.'
        : 'Failed to load suggestions. Please try again.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userCollection, selectedFormats, colorFilter]); // eslint-disable-line

  // Refetch when collection loads, formats, or color filter changes
  useEffect(() => {
    if (userCollection.size > 0) fetchSuggestions();
  }, [userCollection, selectedFormats, colorFilter]); // eslint-disable-line

  // Re-score + re-filter when weights or color filter change
  useEffect(() => {
    if (!suggestions.length) return;
    let filtered = rescore(suggestions, weights);
    // Color filter: show decks whose colors are a subset of the selected colors
    // e.g. pick G+W → show mono-G, mono-W, and G/W decks but not G/W/U
    if (colorFilter.length > 0) {
      filtered = filtered.filter((d) =>
        d.colors.length > 0 && d.colors.every((c) => colorFilter.includes(c))
      );
    }
    setDisplayedSuggestions(filtered);
  }, [weights, suggestions, colorFilter]);

  const toggleFormat = (fmt) => {
    setSelectedFormats((prev) =>
      prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]
    );
  };

  const toggleColor = (c) => {
    setColorFilter((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const resetWeights = () => setWeights({ ...DEFAULT_WEIGHTS });

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20,
      background: '#0a0b14', padding: 20,
      fontFamily: '"DM Sans", system-ui, sans-serif', color: '#e2e8f0',
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        input[type=range] { -webkit-appearance: none; appearance: none; background: #1e2030; border-radius: 4px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; }
      `}</style>

      {/* Sidebar */}
      <aside style={{ background: '#111320', border: '1px solid #1e2030', borderRadius: 14, padding: 20, height: 'fit-content', position: 'sticky', top: 20 }}>

        {/* Format filter */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', margin: '0 0 10px', letterSpacing: 1, textTransform: 'uppercase' }}>Format</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ALL_FORMATS.map((fmt) => {
              const active = selectedFormats.includes(fmt);
              return (
                <button key={fmt} onClick={() => toggleFormat(fmt)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: active ? 'rgba(37,99,235,0.12)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(37,99,235,0.4)' : '#1e2030'}`,
                  borderRadius: 7, padding: '6px 10px', cursor: 'pointer',
                  color: active ? '#93c5fd' : '#475569',
                  fontSize: 12, fontWeight: active ? 600 : 400, textAlign: 'left',
                  textTransform: 'capitalize', transition: 'all 0.15s',
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    background: active ? '#2563eb' : '#1e2030',
                    border: `1px solid ${active ? '#3b82f6' : '#334155'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, color: '#fff',
                  }}>{active ? '✓' : ''}</span>
                  {fmt}
                </button>
              );
            })}
          </div>
          {selectedFormats.length === 0 && (
            <p style={{ fontSize: 11, color: '#ef4444', margin: '6px 0 0' }}>Select at least one format.</p>
          )}
        </div>

        {/* Color filter */}
        <div style={{ marginBottom: 20, paddingTop: 16, borderTop: '1px solid #1e2030' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', margin: 0, letterSpacing: 1, textTransform: 'uppercase' }}>Colors</h2>
            {colorFilter.length > 0 && (
              <button onClick={() => setColorFilter([])} style={{ fontSize: 10, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Clear
              </button>
            )}
          </div>
          <p style={{ fontSize: 11, color: '#475569', margin: '0 0 10px' }}>
            Show decks using only these colors
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            {ALL_COLORS.map((c) => {
              const active = colorFilter.includes(c);
              return (
                <button key={c} onClick={() => toggleColor(c)} title={COLOR_META[c].label} style={{
                  width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
                  border: `2px solid ${active ? '#c9a84c' : '#1e2030'}`,
                  background: active ? 'rgba(201,168,76,0.15)' : '#0f1020',
                  fontSize: 16, transition: 'all 0.15s',
                  transform: active ? 'scale(1.1)' : 'scale(1)',
                  boxShadow: active ? '0 0 8px rgba(201,168,76,0.3)' : 'none',
                }}>
                  {COLOR_META[c].emoji}
                </button>
              );
            })}
          </div>
          {colorFilter.length > 0 && (
            <p style={{ fontSize: 11, color: '#64748b', margin: '8px 0 0' }}>
              Showing decks in {colorFilter.map((c) => COLOR_META[c].label).join(' + ')} only
            </p>
          )}
        </div>

        {/* Score weights */}
        <div style={{ paddingTop: 16, borderTop: '1px solid #1e2030' }}>
          <div style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', margin: 0, letterSpacing: 1, textTransform: 'uppercase' }}>Score Weights</h2>
            <p style={{ fontSize: 11, color: '#475569', margin: '5px 0 0' }}>Drag to adjust what matters most to you</p>
          </div>
        {Object.keys(DEFAULT_WEIGHTS).map((key) => (
          <WeightSlider key={key} metaKey={key} value={weights[key]} onChange={(v) => setWeights((p) => ({ ...p, [key]: v }))} />
        ))}
        <button onClick={resetWeights} style={{ width: '100%', marginTop: 8, background: 'transparent', border: '1px solid #2a2d45', color: '#64748b', borderRadius: 8, padding: '8px 0', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={(e) => { e.target.style.borderColor = '#4b5280'; e.target.style.color = '#94a3b8'; }}
          onMouseLeave={(e) => { e.target.style.borderColor = '#2a2d45'; e.target.style.color = '#64748b'; }}>
          Reset to defaults
        </button>
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #1e2030' }}>
          <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
            Scores update instantly. Weights of <strong style={{ color: '#64748b' }}>0</strong> exclude that dimension entirely.
          </div>
        </div>
        </div> {/* end score weights wrapper */}
      </aside>

      {/* Main */}
      <main>
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: '#f1f5f9', letterSpacing: -0.5 }}>Deck Suggestions</h1>
            <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0' }}>
              {displayedSuggestions.length > 0
                ? `${displayedSuggestions.length} decks ranked by your weighted score`
                : loading ? 'Analysing your collection…' : 'No decks match your filters'}
              {colorFilter.length > 0 && (
                <span style={{ color: '#c9a84c', marginLeft: 6 }}>
                  · {colorFilter.map((c) => COLOR_META[c].emoji).join('')} only
                </span>
              )}
            </p>
          </div>
          <button onClick={fetchSuggestions} disabled={loading} style={{
            background: loading ? '#1e2030' : '#2563eb', color: loading ? '#475569' : '#fff',
            border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13,
            fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
          }}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {loading && (
          <div style={{ background: '#111320', border: '1px solid #1e2030', borderRadius: 12, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
              {progress.label ?? (progress.phase === 'scoring'
                ? `Scoring decks… ${progress.current ?? 0}/${progress.total ?? '?'}`
                : 'Loading deck database…')}
            </div>
            <div style={{ height: 4, background: '#1e2030', borderRadius: 2, overflow: 'hidden', maxWidth: 320, margin: '0 auto' }}>
              <div style={{
                height: '100%',
                width: `${progress.pct ?? (progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 30)}%`,
                background: '#2563eb', borderRadius: 2, transition: 'width 0.3s ease',
                animation: !progress.pct && !progress.total ? 'pulse 1.5s infinite' : 'none',
              }} />
            </div>
            {progress.total > 0 && (
              <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
                {progress.current} / {progress.total} decks scored
              </div>
            )}
          </div>
        )}

        {error && !loading && (
          <div style={{ background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 12, padding: 20, color: '#fca5a5', fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && displayedSuggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayedSuggestions.map((deck, i) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                rank={i + 1}
                isExpanded={expandedId === deck.id}
                onToggle={() => setExpandedId(expandedId === deck.id ? null : deck.id)}
              />
            ))}
          </div>
        )}

        {!loading && !error && displayedSuggestions.length === 0 && userCollection.size === 0 && (
          <div style={{ background: '#111320', border: '1px solid #1e2030', borderRadius: 12, padding: 40, textAlign: 'center', color: '#475569' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 15, marginBottom: 6 }}>Your collection is empty</div>
            <div style={{ fontSize: 13 }}>Import your cards first to get personalised deck suggestions.</div>
          </div>
        )}
      </main>
    </div>
  );
}
