import { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import Collection from './pages/Collection';
import Import from './pages/Import';
import DeckSuggestions from './pages/DeckSuggestions';

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return unsub;
  }, []);

  const login = () => signInWithPopup(auth, googleProvider);
  const logout = () => signOut(auth);

  if (user === undefined) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh' }}>
        <AppNav />
        <main style={{ flex:1, maxWidth:1200, margin:'0 auto', width:'100%', padding:'32px 24px' }}>
          {user ? (
            <Routes>
              <Route path="/" element={<Collection />} />
              <Route path="/import" element={<Import />} />
              <Route path="/decks" element={<DeckSuggestions />} />
            </Routes>
          ) : (
            <Landing />
          )}
        </main>
      </div>
    </AuthContext.Provider>
  );
}

function AppNav() {
  const { user, login, logout } = useAuth();
  const navStyle = {
    borderBottom:'1px solid var(--border)', background:'var(--bg-card)',
    padding:'0 24px', display:'flex', alignItems:'center', gap:32,
    height:64, position:'sticky', top:0, zIndex:100,
  };
  const linkStyle = (active) => ({
    padding:'6px 16px', borderRadius:'var(--radius)',
    fontFamily:'var(--font-display)', fontSize:13, fontWeight:600,
    letterSpacing:'0.06em', textTransform:'uppercase', textDecoration:'none',
    color: active ? 'var(--gold-bright)' : 'var(--text-secondary)',
    background: active ? 'var(--gold-glow)' : 'transparent',
    border: active ? '1px solid var(--border-gold)' : '1px solid transparent',
    transition:'all 0.2s',
  });

  return (
    <nav style={navStyle}>
      <span style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, color:'var(--gold-bright)', letterSpacing:'0.06em' }}>
        Sleeved
      </span>
      {user && (
        <div style={{ display:'flex', gap:4 }}>
          {[['/', 'Collection'], ['/import', 'Import'], ['/decks', 'Deck Suggestions']].map(([to, label]) => (
            <NavLink key={to} to={to} end={to==='/'} style={({ isActive }) => linkStyle(isActive)}>{label}</NavLink>
          ))}
        </div>
      )}
      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:12 }}>
        {user
          ? <><span style={{ color:'var(--text-secondary)', fontSize:14 }}>{user.displayName}</span>
              <button className="btn" onClick={logout}>Sign Out</button></>
          : <button className="btn btn-primary" onClick={login}>Sign In with Google</button>
        }
      </div>
    </nav>
  );
}

function Landing() {
  const { login } = useAuth();
  const features = [
    { icon:'📦', title:'Track Your Collection', desc:'Add cards manually or bulk-import from Moxfield, Archidekt, MTGGoldfish, Manabox, and more.' },
    { icon:'🔮', title:'Smart Deck Suggestions', desc:'Get AI-powered deck recommendations based on cards you already own, filtered by format and strategy.' },
    { icon:'⚡', title:'Sync from Any Site', desc:'Paste a decklist, upload a CSV, or import your full collection export in seconds.' },
  ];
  return (
    <div style={{ textAlign:'center', paddingTop:80 }} className="fade-in">
      <h1 style={{ fontFamily:'var(--font-display)', fontSize:48, fontWeight:700, color:'var(--gold-bright)', letterSpacing:'0.05em', marginBottom:16 }}>
        Sleeved
      </h1>
      <p style={{ color:'var(--text-secondary)', fontSize:20, maxWidth:480, margin:'0 auto 40px' }}>
        Track your MTG collection, import cards from any platform, and get intelligent deck suggestions.
      </p>
      <button className="btn btn-primary" onClick={login} style={{ fontSize:15, padding:'14px 32px', marginBottom:64 }}>
        Get Started
      </button>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:24, maxWidth:800, margin:'0 auto' }}>
        {features.map(({ icon, title, desc }) => (
          <div key={title} className="card-panel" style={{ textAlign:'left' }}>
            <div style={{ fontSize:28, marginBottom:12 }}>{icon}</div>
            <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, color:'var(--gold-bright)', marginBottom:8 }}>{title}</h3>
            <p style={{ color:'var(--text-secondary)', fontSize:15, lineHeight:1.5 }}>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
