import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';

const SECTIONS = [
  {
    to: '/collection/add',
    icon: '＋',
    title: 'Input Cards',
    desc: 'Add cards to your collection manually or by searching.',
    color: '#c9a84c',
  },
  {
    to: '/collection',
    icon: '📦',
    title: 'My Collection',
    desc: 'Browse and manage every card you own.',
    color: '#5ab4f0',
  },
  {
    to: '/decks',
    icon: '🔮',
    title: 'My Decks',
    desc: 'View and edit the decks you have built.',
    color: '#c88edc',
  },
  {
    to: '/decks/suggest',
    icon: '⚡',
    title: 'Find Compatible Decks',
    desc: 'Get deck suggestions built from cards you already own.',
    color: '#60c878',
  },
  {
    to: '/browse/decks',
    icon: '🗂',
    title: 'Browse Decks',
    desc: 'Explore popular and community decks for inspiration.',
    color: '#f07050',
  },
  {
    to: '/browse/cards',
    icon: '🃏',
    title: 'Browse Cards',
    desc: 'Search the full MTG card database via Scryfall.',
    color: '#f0c040',
  },
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = user?.displayName?.split(' ')[0] || 'Planeswalker';

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 36 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 32,
          fontWeight: 700,
          color: 'var(--gold-bright)',
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}>
          Welcome back, {firstName}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 17 }}>What would you like to do today?</p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 20,
      }}>
        {SECTIONS.map(({ to, icon, title, desc, color }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '28px 24px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = color;
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = `0 8px 32px ${color}22`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ fontSize: 32 }}>{icon}</div>
            <div>
              <h2 style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 600,
                color: color,
                letterSpacing: '0.04em',
                marginBottom: 6,
              }}>{title}</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
