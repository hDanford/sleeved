import { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import Dashboard from './pages/Dashboard';
import Collection from './pages/Collection';
import Import from './pages/Import';
import DeckSuggestions from './pages/DeckSuggestions';
import BrowseCards from './pages/BrowseCards';
import BrowseDecks from './pages/BrowseDecks';

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => { if (result?.user) setUser(result.user); })
      .catch((e) => console.error('redirect error', e));
    const unsub = onAuthStateChanged(auth, (u) => {
      console.log('auth state changed', u);
      setUser(u || null);
    });
    return unsub;
  }, []);

  const login = () => signInWithRedirect(auth, googleProvider);
  const logout = () => signOut(auth);

  if (user === undefined) {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}><div className="spinner" /></div>;
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh' }}>
        <AppNav />
        <main style={{ flex:1, maxWidth:1200, margin:'0 auto', width:'100%', padding:'32px 24px' }}>
          {user ? (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/collection" element={<Collection />} />
              <Route path="/collection/add" element={<Collection />} />
              <Route path="/import" element={<Import />} />
              <Route path="/decks" element={<MyDecks />} />
              <Route path="/decks/suggest" element={<DeckSuggestions />} />
              <Route path="/browse/decks" element={<BrowseDecks />} />
              <Route path="/browse/cards" element={<BrowseCards />} />
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
  const { user, logout } = useAuth();
  const links = [
    { to:'/', label:'Home', end:true },
    { to:'/collection', label:'My Collection' },
    { to:'/decks', label:'My Decks' },
    { to:'/decks/suggest', label:'Deck Suggestions' },
    { to:'/browse/decks', label:'Browse Decks' },
    { to:'/browse/cards', label:'Browse Cards' },
  ];
  const ls = (active) => ({
    padding:'6px 12px', borderRadius:'var(--radius)', fontFamily:'var(--font-display)',
    fontSize:12, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase',
    textDecoration:'none', whiteSpace:'nowrap', transition:'all 0.2s',
    color: active ? 'var(--gold-bright)' : 'var(--text-secondary)',
    background: active ? 'var(--gold-glow)' : 'transparent',
    border: active ? '1px solid var(--border-gold)' : '1px solid transparent',
  });
  return (
    <nav style={{ borderBottom:'1px solid var(--border)', background:'var(--bg-card)', padding:'0 24px', display:'flex', alignItems:'center', height:60, position:'sticky', top:0, zIndex:100, gap:8 }}>
      <NavLink to="/" style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:700, color:'var(--gold-bright)', letterSpacing:'0.08em', textDecoration:'none', marginRight:16, flexShrink:0 }}>Sleeved</NavLink>
      {user && <div style={{ display:'flex', gap:2, overflowX:'auto', flex:1 }}>{links.map(({ to, label, end }) => <NavLink key={to} to={to} end={end} style={({ isActive }) => ls(isActive)}>{label}</NavLink>)}</div>}
      <div style={{ marginLeft:'auto', flexShrink:0 }}>{user && <button className="btn" onClick={logout} style={{ fontSize:12, padding:'6px 14px' }}>Sign Out</button>}</div>
    </nav>
  );
}

function MyDecks() {
  const navigate = useNavigate();
  return (
    <div className="fade-in">
      <h1 className="section-title" style={{ marginBottom:6 }}>My Decks</h1>
      <p style={{ color:'var(--text-secondary)', marginBottom:32 }}>Your saved decks will appear here.</p>
      <div className="card-panel" style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>
        <p style={{ fontFamily:'var(--font-display)', fontSize:18, marginBottom:12 }}>No decks yet</p>
        <p style={{ fontSize:15, marginBottom:24 }}>Build one from your collection using Deck Suggestions.</p>
        <button className="btn btn-primary" onClick={() => navigate('/decks/suggest')}>Find Compatible Decks</button>
      </div>
    </div>
  );
}

function Landing() {
  const { login } = useAuth();
  const features = [
    { icon:'📦', title:'Track Your Collection', desc:'Add cards manually or bulk-import from Moxfield, Archidekt, Manabox, and more.' },
    { icon:'🔮', title:'Smart Deck Suggestions', desc:'Get deck recommendations based on cards you already own.' },
    { icon:'⚡', title:'Sync from Any Site', desc:'Paste a decklist or upload a CSV export in seconds.' },
  ];
  return (
    <div style={{ textAlign:'center', paddingTop:80 }} className="fade-in">
      <h1 style={{ fontFamily:'var(--font-display)', fontSize:52, fontWeight:700, color:'var(--gold-bright)', letterSpacing:'0.06em', marginBottom:16 }}>Sleeved</h1>
      <p style={{ color:'var(--text-secondary)', fontSize:20, maxWidth:440, margin:'0 auto 40px' }}>Track your MTG collection, import cards from any platform, and get intelligent deck suggestions.</p>
      <button className="btn btn-primary" onClick={login} style={{ fontSize:15, padding:'14px 36px', marginBottom:64 }}>Sign In with Google</button>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:24, maxWidth:800, margin:'0 auto' }}>
        {features.map(({ icon, title, desc }) => (
          <div key={title} className="card-panel" style={{ textAlign:'left' }}>
            <div style={{ fontSize:28, marginBottom:12 }}>{icon}</div>
            <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, color:'var(--gold-bright)', marginBottom:8 }}>{title}</h3>
            <p style={{ color:'var(--text-secondary)', fontSize:14, lineHeight:1.5 }}>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
