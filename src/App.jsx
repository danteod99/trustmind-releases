import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ProfileList from './components/ProfileList';
import ProxyImport from './components/ProxyImport';
import Automations from './components/Automations';
import Scheduler from './components/Scheduler';
import Warmup from './components/Warmup';
import ShadowbanCheck from './components/ShadowbanCheck';
import Followers from './components/Followers';
import Scraper from './components/Scraper';
import Settings from './components/Settings';
import LoginScreen from './components/auth/LoginScreen';
import RegisterScreen from './components/auth/RegisterScreen';
import PaymentModal from './components/payments/PaymentModal';
import UpdateNotification from './components/UpdateNotification';

const TABS = {
  dashboard: 'Dashboard',
  profiles: 'Perfiles',
  automations: 'Automatizaciones',
  scheduler: 'Programador',
  warmup: 'Warm-up',
  shadowban: 'Shadowban',
  followers: 'Seguidores',
  scraper: 'Scraper',
  proxies: 'Proxies',
  settings: 'Configuracion',
};

// Tabs that require Pro
const PRO_TABS = ['scheduler', 'warmup', 'shadowban', 'scraper'];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState(null);
  const [tier, setTier] = useState('free');
  const [authLoading, setAuthLoading] = useState(true);
  const [authView, setAuthView] = useState('login'); // 'login' or 'register'
  const [showPayment, setShowPayment] = useState(false);

  useEffect(() => {
    window.api.getSession().then((session) => {
      if (session?.user) {
        setUser(session.user);
        setTier(session.tier || 'free');
      }
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));

    // Listen for auth/tier changes
    window.api.onAuthStateChange?.((data) => {
      if (data.user) {
        setUser(data.user);
        setTier(data.tier || 'free');
      } else {
        setUser(null);
        setTier('free');
      }
    });
  }, []);

  const handleLogin = (userData, userTier) => {
    setUser(userData);
    setTier(userTier || 'free');
  };

  const handleLogout = async () => {
    await window.api.logout();
    setUser(null);
    setTier('free');
    setActiveTab('dashboard');
  };

  const handlePaymentSuccess = () => {
    setTier('pro');
    setShowPayment(false);
  };

  // Loading screen
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-trust-dark">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">
            <span className="text-white">Trust</span>
            <span className="bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] bg-clip-text text-transparent">Insta</span>
          </h1>
          <p className="text-white/40 text-sm">Cargando...</p>
        </div>
      </div>
    );
  }

  // Auth screens
  if (!user) {
    if (authView === 'register') {
      return <RegisterScreen onSwitchToLogin={() => setAuthView('login')} />;
    }
    return <LoginScreen onLogin={handleLogin} onSwitchToRegister={() => setAuthView('register')} />;
  }

  // Main app
  return (
    <div className="flex h-screen bg-trust-bg">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tabs={TABS}
        tier={tier}
        user={user}
        onLogout={handleLogout}
        onUpgrade={() => setShowPayment(true)}
        proTabs={PRO_TABS}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <UpdateNotification />
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'profiles' && <ProfileList tier={tier} onUpgrade={() => setShowPayment(true)} />}
        {activeTab === 'automations' && <Automations tier={tier} onUpgrade={() => setShowPayment(true)} />}
        {activeTab === 'scheduler' && <Scheduler tier={tier} onUpgrade={() => setShowPayment(true)} />}
        {activeTab === 'warmup' && <Warmup tier={tier} onUpgrade={() => setShowPayment(true)} />}
        {activeTab === 'shadowban' && <ShadowbanCheck tier={tier} onUpgrade={() => setShowPayment(true)} />}
        {activeTab === 'followers' && <Followers />}
        {activeTab === 'scraper' && <Scraper tier={tier} onUpgrade={() => setShowPayment(true)} />}
        {activeTab === 'proxies' && <ProxyImport />}
        {activeTab === 'settings' && <Settings tier={tier} user={user} onUpgrade={() => setShowPayment(true)} />}
      </main>
      {showPayment && <PaymentModal onClose={() => setShowPayment(false)} onSuccess={handlePaymentSuccess} />}
    </div>
  );
}
