import React, { useState, useEffect } from 'react';
import UpgradePrompt from './shared/UpgradePrompt';

function getShadowbanBadge(status) {
  if (!status || status.lastChecked === undefined) {
    return { label: 'Sin verificar', classes: 'bg-gray-100 text-gray-500' };
  }
  if (status.shadowbanned === true) {
    return { label: 'Shadowban detectado', classes: 'bg-trust-red/10 text-trust-red' };
  }
  const checks = status.checks || {};
  const someBlocked = checks.hashtag === false || checks.explore === false || checks.storyReach === false;
  if (someBlocked) {
    return { label: 'Posible restriccion', classes: 'bg-trust-yellow/10 text-trust-yellow' };
  }
  return { label: 'Limpia', classes: 'bg-trust-green/10 text-trust-green' };
}

function CheckIcon({ passed }) {
  if (passed === true) {
    return (
      <svg className="w-4 h-4 text-trust-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (passed === false) {
    return (
      <svg className="w-4 h-4 text-trust-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
    </svg>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

export default function ShadowbanCheck({ tier, onUpgrade }) {
  const [profiles, setProfiles] = useState([]);
  const [runningIds, setRunningIds] = useState([]);
  const [shadowbanStatus, setShadowbanStatus] = useState({});
  const [checking, setChecking] = useState({});
  const [bulkChecking, setBulkChecking] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const data = await window.api.listProfiles();
      setProfiles(data);
      const status = await window.api.getBrowserStatus();
      setRunningIds(status);
      const allShadowban = await window.api.getAllShadowbanStatus();
      setShadowbanStatus(allShadowban || {});
    } catch (err) {
      // silently retry
    }
  };

  const handleCheck = async (profileId) => {
    setChecking((prev) => ({ ...prev, [profileId]: true }));
    try {
      const result = await window.api.checkShadowban(profileId);
      setShadowbanStatus((prev) => ({
        ...prev,
        [profileId]: { ...result, lastChecked: new Date().toISOString() },
      }));
    } catch (err) {
      setShadowbanStatus((prev) => ({
        ...prev,
        [profileId]: { error: err.message, lastChecked: new Date().toISOString() },
      }));
    } finally {
      setChecking((prev) => ({ ...prev, [profileId]: false }));
    }
  };

  const handleCheckAll = async () => {
    setBulkChecking(true);
    try {
      const BATCH_SIZE = 5;
      for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
        const batch = profiles.slice(i, i + BATCH_SIZE);
        for (const p of batch) {
          setChecking((prev) => ({ ...prev, [p.id]: true }));
          try {
            const result = await window.api.checkShadowban(p.id);
            setShadowbanStatus((prev) => ({
              ...prev,
              [p.id]: { ...result, lastChecked: new Date().toISOString() },
            }));
          } catch (err) {
            setShadowbanStatus((prev) => ({
              ...prev,
              [p.id]: { error: err.message, lastChecked: new Date().toISOString() },
            }));
          } finally {
            setChecking((prev) => ({ ...prev, [p.id]: false }));
          }
        }
        if (i + BATCH_SIZE < profiles.length) {
          await new Promise((r) => setTimeout(r, 8000));
        }
      }
    } finally {
      setBulkChecking(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {tier !== 'pro' && <UpgradePrompt feature="shadowban" onUpgrade={onUpgrade} onClose={() => {}} />}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-trust-dark">Detector de Shadowban</h2>
        <button
          onClick={handleCheckAll}
          disabled={bulkChecking}
          className="px-4 py-2.5 bg-trust-accent text-white rounded-lg text-sm font-bold hover:bg-trust-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-trust"
        >
          {bulkChecking ? 'Verificando...' : 'Verificar Todas'}
        </button>
      </div>
      <p className="text-trust-muted text-sm mb-5">
        Verifica si tus cuentas tienen restricciones de visibilidad en Instagram
      </p>

      {profiles.length === 0 ? (
        <div className="bg-white border border-trust-border rounded-xl p-8 shadow-trust text-center">
          <p className="text-trust-muted text-sm">No hay perfiles creados. Agrega perfiles primero.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {profiles.map((profile) => {
            const ss = shadowbanStatus[profile.id] || {};
            const badge = getShadowbanBadge(ss);
            const checks = ss.checks || {};
            const isBrowserOpen = runningIds.includes(profile.id);
            const isChecking = checking[profile.id] || false;
            const hasBeenChecked = ss.lastChecked !== undefined;

            return (
              <div
                key={profile.id}
                className={`bg-white border rounded-xl p-5 shadow-trust transition-all ${
                  ss.shadowbanned === true
                    ? 'border-trust-red/30'
                    : ss.shadowbanned === false
                    ? 'border-trust-green/30'
                    : 'border-trust-border'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-trust-dark truncate">{profile.name}</h3>
                    {profile.ig_user && (
                      <p className="text-xs text-trust-muted">@{profile.ig_user}</p>
                    )}
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${badge.classes}`}>
                    {badge.label}
                  </span>
                </div>

                {/* Check results */}
                {hasBeenChecked && !ss.error && (
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between bg-trust-surface rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <CheckIcon passed={checks.hashtag} />
                        <span className="text-xs font-medium text-trust-dark">Hashtags</span>
                      </div>
                      <span className={`text-xs font-semibold ${checks.hashtag === true ? 'text-trust-green' : checks.hashtag === false ? 'text-trust-red' : 'text-gray-400'}`}>
                        {checks.hashtag === true ? 'Visible' : checks.hashtag === false ? 'Bloqueado' : '--'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between bg-trust-surface rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <CheckIcon passed={checks.explore} />
                        <span className="text-xs font-medium text-trust-dark">Explorar</span>
                      </div>
                      <span className={`text-xs font-semibold ${checks.explore === true ? 'text-trust-green' : checks.explore === false ? 'text-trust-red' : 'text-gray-400'}`}>
                        {checks.explore === true ? 'Visible' : checks.explore === false ? 'Oculto' : '--'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between bg-trust-surface rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <CheckIcon passed={checks.storyReach} />
                        <span className="text-xs font-medium text-trust-dark">Stories</span>
                      </div>
                      <span className={`text-xs font-semibold ${checks.storyReach === true ? 'text-trust-green' : checks.storyReach === false ? 'text-trust-red' : 'text-gray-400'}`}>
                        {checks.storyReach === true ? 'Normal' : checks.storyReach === false ? 'Reducido' : '--'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Error message */}
                {ss.error && (
                  <div className="bg-trust-red/5 border border-trust-red/20 rounded-lg px-3 py-2.5 mb-4">
                    <p className="text-xs text-trust-red">{ss.error}</p>
                  </div>
                )}

                {/* Message */}
                {ss.message && !ss.error && (
                  <div className="bg-trust-surface rounded-lg px-3 py-2 mb-4">
                    <p className="text-xs text-trust-muted">{ss.message}</p>
                  </div>
                )}

                {/* Last checked */}
                {hasBeenChecked && (
                  <p className="text-xs text-trust-muted mb-3">
                    Ultima verificacion: {formatDate(ss.lastChecked)}
                  </p>
                )}

                {/* Action button */}
                <button
                    onClick={() => handleCheck(profile.id)}
                    disabled={isChecking}
                    className={`w-full px-4 py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-40 ${
                      isChecking
                        ? 'bg-trust-surface text-trust-muted cursor-wait'
                        : 'bg-trust-accent text-white hover:bg-trust-accent-hover shadow-trust'
                    }`}
                  >
                    {isChecking ? 'Verificando...' : 'Verificar'}
                  </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
