// src/components/DeckSuggestions.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { generateSuggestions, rescore } from '../utils/deckSuggestions';
import { DEFAULT_WEIGHTS, SCORE_META } from '../utils/deckScoring';

// ---------------------------------------------------------------------------
// Mini arc/ring chart for the main score
// ---------------------------------------------------------------------------
function ScoreRing({ score, size = 72 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color =
    score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a3a" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1)' }}
      />
      <text
        x={size / 2}
        y={size / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={size * 0.22}
        fontWeight="700"
        style={{ transform: 'rotate(90deg)', transformOrigin: `${size / 2}px ${size / 2}px`, fontFamily: 'monospace' }}
      >
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
        <div
          style={{
            height: '100%',
            width: `${score}%`,
            background: color,
            borderRadius: 2,
            transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
            boxShadow: `0 0 6px ${color}55`,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single deck card
// ---------------------------------------------------------------------------
function DeckCard({ deck, rank, weights, isExpanded, onToggle }) {
  const colorBadgeStyle = (color) => {
    const map = {
      W: { bg: '#fefce8', text: '#854d0e', label: '☀' },
      U: { bg: '#eff6ff', text: '#1e40af', label: '💧' },
      B: { bg: '#1a1a2e', text: '#a78bfa', label: '💀' },
      R: { bg: '#fff1f2', text: '#9f1239', label: '🔥' },
      G: { bg: '#f0fdf4', text: '#14532d', label: '🌿' },
    };
    return map[color] ?? { bg: '#1e2030', text: '#94a3b8', label: color };
  };

  const rankColor = rank === 1 ? '#fbbf24' : rank === 2 ? '#94a3b8' : rank === 3 ? '#cd7f32' : '#475569';

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
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#3b4070';
        e.currentTarget.style.background = '#16182a';
      }}
      onMouseLeave={(e) => {
        if (!isExpanded) {
          e.currentTarget.style.borderColor = '#1e2030';
          e.currentTarget.style.background = '#111320';
        }
      }}
    >
      {/* Rank badge */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        background: rankColor, color: '#000',
        fontSize: 10, fontWeight: 800, padding: '3px 10px 3px 8px',
        borderBottomRightRadius: 8, letterSpacing: 1,
        fontFamily: 'monospace',
      }}>
        #{rank}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        <ScoreRing score={deck.mainScore} size={72} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
            {deck.name}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
            {deck.colors.map((c) => {
              const s = colorBadgeStyle(c);
              return (
                <span key={c} style={{
                  background: '#1e2030', color: '#94a3b8',
                  fontSize: 13, padding: '1px 6px', borderRadius: 4,
                }}>
                  {s.label}
                </span>
              );
            })}
            <span style={{
              background: '#1e2030', color: '#64748b',
              fontSize: 10, padding: '2px 7px', borderRadius: 4,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {deck.strategy}
            </span>
            <span style={{
              background: '#1e2030', color: '#64748b',
              fontSize: 10, padding: '2px 7px', borderRadius: 4,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {deck.format}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{deck.description}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            <span style={{ color: '#22c55e', fontWeight: 700 }}>
              ${deck.totalCost?.toFixed(2) ?? '—'}
            </span> to complete
          </div>
          <div style={{ fontSize: 11, color: '#475569' }}>
            {deck.missingCards?.length ?? 0} cards needed
          </div>
          <div style={{ fontSize: 18, color: '#475569', marginTop: 2, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>
            ⌄
          </div>
        </div>
      </div>

      {/* Expanded sub-scores */}
      {isExpanded && (
        <div style={{
          marginTop: 16,
          paddingTop: 16,
          borderTop: '1px solid #1e2030',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
            {Object.entries(SCORE_META).map(([key, meta]) => (
              <SubScoreBar
                key={key}
                label={meta.label}
                score={deck.subscores[key] ?? 0}
                color={meta.color}
                icon={meta.icon}
              />
            ))}
          </div>

          {deck.missingCards?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                Cards to Acquire
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {deck.missingCards.slice(0, 12).map((c) => (
                  <span key={c.name} style={{
                    background: '#1a1c2e',
                    border: '1px solid #2a2d45',
                    borderRadius: 6,
                    padding: '3px 9px',
                    fontSize: 11,
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
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
                {deck.missingCards.length > 12 && (
                  <span style={{ fontSize: 11, color: '#475569', padding: '3px 0' }}>
                    +{deck.missingCards.length - 12} more
                  </span>
                )}
              </div>
            </div>
          )}
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
      <input
        type="range"
        min={0}
        max={2}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          accentColor: meta.color,
          height: 4,
          cursor: 'pointer',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DeckSuggestions({
  userCollection,     // Map<cardNameLower, qty>
  userDeckProfiles,   // Array of buildDeckProfile() results
  format,             // Optional format filter
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [displayedSuggestions, setDisplayedSuggestions] = useState([]);
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState(null);
  const hasFetched = useRef(false);

  // Initial fetch
  const fetchSuggestions = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    hasFetched.current = true;
    try {
      const results = await generateSuggestions({
        userCollection,
        userDeckProfiles,
        weights,
        format,
        onProgress: (current, total) => setProgress({ current, total }),
      });
      setSuggestions(results);
      setDisplayedSuggestions(results);
    } catch (e) {
      setError('Failed to generate suggestions. Please try again.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userCollection, userDeckProfiles, format]); // eslint-disable-line

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  // Re-score without re-fetching when weights change
  useEffect(() => {
    if (!suggestions.length) return;
    setDisplayedSuggestions(rescore(suggestions, weights));
  }, [weights, suggestions]);

  const updateWeight = (key, value) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  };

  const resetWeights = () => setWeights({ ...DEFAULT_WEIGHTS });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '260px 1fr',
      gap: 20,
      minHeight: '100vh',
      background: '#0a0b14',
      padding: 20,
      fontFamily: '"DM Sans", system-ui, sans-serif',
      color: '#e2e8f0',
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        input[type=range] { -webkit-appearance: none; appearance: none; background: #1e2030; border-radius: 4px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; }
      `}</style>

      {/* Sidebar — weights */}
      <aside style={{
        background: '#111320',
        border: '1px solid #1e2030',
        borderRadius: 14,
        padding: 20,
        height: 'fit-content',
        position: 'sticky',
        top: 20,
      }}>
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', margin: 0, letterSpacing: 1, textTransform: 'uppercase' }}>
            Score Weights
          </h2>
          <p style={{ fontSize: 11, color: '#475569', margin: '5px 0 0' }}>
            Drag to adjust what matters most to you
          </p>
        </div>

        {Object.keys(DEFAULT_WEIGHTS).map((key) => (
          <WeightSlider
            key={key}
            metaKey={key}
            value={weights[key]}
            onChange={(v) => updateWeight(key, v)}
          />
        ))}

        <button
          onClick={resetWeights}
          style={{
            width: '100%', marginTop: 8,
            background: 'transparent', border: '1px solid #2a2d45',
            color: '#64748b', borderRadius: 8, padding: '8px 0',
            fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.target.style.borderColor = '#4b5280'; e.target.style.color = '#94a3b8'; }}
          onMouseLeave={(e) => { e.target.style.borderColor = '#2a2d45'; e.target.style.color = '#64748b'; }}
        >
          Reset to defaults
        </button>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #1e2030' }}>
          <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
            Scores update instantly — no need to re-fetch.
            Weights of <strong style={{ color: '#64748b' }}>0</strong> exclude that dimension entirely.
          </div>
        </div>
      </aside>

      {/* Main panel */}
      <main>
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: '#f1f5f9', letterSpacing: -0.5 }}>
              Deck Suggestions
            </h1>
            <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0' }}>
              {displayedSuggestions.length > 0
                ? `${displayedSuggestions.length} decks ranked by your weighted score`
                : 'Analysing your collection…'}
            </p>
          </div>
          <button
            onClick={fetchSuggestions}
            disabled={loading}
            style={{
              background: loading ? '#1e2030' : '#2563eb',
              color: loading ? '#475569' : '#fff',
              border: 'none', borderRadius: 8, padding: '9px 18px',
              fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{
            background: '#111320', border: '1px solid #1e2030', borderRadius: 12,
            padding: 32, textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
              Fetching card data from Scryfall…
            </div>
            <div style={{ height: 4, background: '#1e2030', borderRadius: 2, overflow: 'hidden', maxWidth: 320, margin: '0 auto' }}>
              <div style={{
                height: '100%',
                width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '30%',
                background: '#2563eb',
                borderRadius: 2,
                transition: 'width 0.3s ease',
                animation: progress.total === 0 ? 'pulse 1.5s infinite' : 'none',
              }} />
            </div>
            {progress.total > 0 && (
              <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
                {progress.current} / {progress.total} archetypes scored
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div style={{
            background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 12,
            padding: 20, color: '#fca5a5', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Deck list */}
        {!loading && displayedSuggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayedSuggestions.map((deck, i) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                rank={i + 1}
                weights={weights}
                isExpanded={expandedId === deck.id}
                onToggle={() => setExpandedId(expandedId === deck.id ? null : deck.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
