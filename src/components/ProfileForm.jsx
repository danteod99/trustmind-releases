import React, { useState } from 'react';

const TIMEZONES = [
  'America/Lima',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Bogota',
  'America/Mexico_City',
  'America/Buenos_Aires',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
];

const IG_ICON = (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>
);

const INPUT_CLASS = 'w-full bg-trust-surface border border-trust-border rounded-lg px-3 py-2.5 text-trust-dark text-sm focus:outline-none focus:border-trust-accent focus:ring-1 focus:ring-trust-accent/20';
const LABEL_CLASS = 'block text-xs text-trust-muted font-medium mb-1.5';

export default function ProfileForm({ profile, onSave, onBulkSave, onCancel }) {
  const isEditing = !!profile;

  const [form, setForm] = useState({
    name: profile?.name || '',
    ig_user: profile?.ig_user || '',
    ig_pass: profile?.ig_pass || '',
    ig_2fa_secret: profile?.ig_2fa_secret || '',
    ig_email: profile?.ig_email || '',
    ig_email_pass: profile?.ig_email_pass || '',
    proxy_type: profile?.proxy_type || 'http',
    proxy_host: profile?.proxy_host || '',
    proxy_port: profile?.proxy_port || '',
    proxy_user: profile?.proxy_user || '',
    proxy_pass: profile?.proxy_pass || '',
    user_agent: profile?.user_agent || '',
    timezone: profile?.timezone || 'America/Lima',
    notes: profile?.notes || '',
  });

  const [bulkText, setBulkText] = useState('');
  const [bulkParsed, setBulkParsed] = useState([]);
  const [bulkTimezone, setBulkTimezone] = useState('America/Lima');
  const [bulkLoading, setBulkLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return alert('El nombre es requerido');
    onSave(form);
  };

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const detectFieldType = (value) => {
    if (!value) return 'unknown';
    const v = value.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
    if (/^\+?\d[\d\s\-()]{6,}$/.test(v)) return 'phone';
    if (/^[A-Z2-7]{16,}$/i.test(v)) return 'twofa';
    return 'text';
  };

  const parseBulk = () => {
    const lines = bulkText.split('\n').filter((l) => l.trim());
    const accounts = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/[|:;\t,]/).map(p => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;

      const detected = parts.map(p => ({ value: p, type: detectFieldType(p) }));
      const account = { user: '', pass: '', twofa: '', email: '', emailPass: '' };

      const emails = detected.filter(d => d.type === 'email');
      const phones = detected.filter(d => d.type === 'phone');
      const twofas = detected.filter(d => d.type === 'twofa');
      const texts = detected.filter(d => d.type === 'text');

      if (emails.length >= 1) account.email = emails[0].value;
      if (emails.length >= 2) account.emailPass = emails[1].value;
      if (phones.length >= 1) account.user = account.user || phones[0].value;
      if (twofas.length >= 1) account.twofa = twofas[0].value;

      if (texts.length >= 1) account.user = texts[0].value.replace(/^@/, '');
      if (texts.length >= 2) account.pass = texts[1].value;
      if (texts.length >= 3 && !account.emailPass) account.emailPass = texts[2].value;

      if (!account.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.user)) {
        account.email = account.user;
      }
      if (!account.user && account.email) account.user = account.email;

      if (!account.pass && parts.length === 2) {
        const first = parts[0].trim();
        const second = parts[1].trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first)) {
          account.user = first;
          account.email = first;
          account.pass = second;
        } else {
          account.user = first.replace(/^@/, '');
          account.pass = second;
        }
      }

      if (account.user && account.pass) {
        accounts.push(account);
      }
    }
    setBulkParsed(accounts);
  };

  const handleBulkImport = async () => {
    if (bulkParsed.length === 0) return;
    setBulkLoading(true);
    await onBulkSave(bulkParsed, bulkTimezone);
    setBulkLoading(false);
  };

  const removeParsed = (index) => {
    setBulkParsed((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Edit mode ────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white border border-trust-border rounded-2xl w-full max-w-lg p-6 shadow-trust-lg max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-bold text-trust-dark mb-4">Editar Perfil</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={LABEL_CLASS}>Nombre del perfil</label>
              <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Ej: Cuenta IG Principal" className={INPUT_CLASS} />
            </div>

            <div className="border border-trust-accent/20 rounded-xl p-4 bg-trust-accent/[0.03]">
              <h4 className="text-sm font-semibold text-trust-accent mb-3 flex items-center gap-2">
                {IG_ICON} Cuenta de Instagram
              </h4>
              <div>
                <label className={LABEL_CLASS}>Usuario / Password <span className="text-trust-muted/50">(separado por /)</span></label>
                <input
                  type="text"
                  value={form.ig_user && form.ig_pass ? `${form.ig_user}/${form.ig_pass}` : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const seps = ['/', ',', ':', '|'];
                    for (const sep of seps) {
                      const idx = val.indexOf(sep);
                      if (idx > 0) {
                        update('ig_user', val.substring(0, idx).trim().replace(/^@/, ''));
                        update('ig_pass', val.substring(idx + 1).trim());
                        return;
                      }
                    }
                    update('ig_user', val.replace(/^@/, ''));
                    update('ig_pass', '');
                  }}
                  placeholder="usuario/password"
                  className={INPUT_CLASS + ' font-mono'}
                />
              </div>
              <div className="mt-3">
                <label className={LABEL_CLASS}>2FA Secret (TOTP)</label>
                <input type="text" value={form.ig_2fa_secret || ''} onChange={(e) => update('ig_2fa_secret', e.target.value)} placeholder="5ZKSD3LECYNXTCMZ4EZA4GDC62FZ7SZY" className={INPUT_CLASS + ' font-mono'} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className={LABEL_CLASS}>Email de la cuenta</label>
                  <input type="text" value={form.ig_email || ''} onChange={(e) => update('ig_email', e.target.value)} placeholder="user@email.com" className={INPUT_CLASS} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Password del email</label>
                  <input type="password" value={form.ig_email_pass || ''} onChange={(e) => update('ig_email_pass', e.target.value)} placeholder="***" className={INPUT_CLASS} />
                </div>
              </div>
            </div>

            <div className="border border-trust-border rounded-xl p-4">
              <h4 className="text-sm font-semibold text-trust-muted mb-3">Configuracion de Proxy</h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={LABEL_CLASS}>Tipo</label>
                  <select value={form.proxy_type} onChange={(e) => update('proxy_type', e.target.value)} className={INPUT_CLASS}>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLASS}>Host / IP</label>
                  <input type="text" value={form.proxy_host} onChange={(e) => update('proxy_host', e.target.value)} placeholder="123.45.67.89" className={INPUT_CLASS} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Puerto</label>
                  <input type="text" value={form.proxy_port} onChange={(e) => update('proxy_port', e.target.value)} placeholder="8080" className={INPUT_CLASS} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className={LABEL_CLASS}>Usuario (opcional)</label>
                  <input type="text" value={form.proxy_user} onChange={(e) => update('proxy_user', e.target.value)} placeholder="user123" className={INPUT_CLASS} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Password (opcional)</label>
                  <input type="password" value={form.proxy_pass} onChange={(e) => update('proxy_pass', e.target.value)} placeholder="***" className={INPUT_CLASS} />
                </div>
              </div>
            </div>

            <div>
              <label className={LABEL_CLASS}>Zona horaria</label>
              <select value={form.timezone} onChange={(e) => update('timezone', e.target.value)} className={INPUT_CLASS}>
                {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS}>Notas</label>
              <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Ej: Cuenta de Instagram para likes" rows={2} className={INPUT_CLASS + ' resize-none'} />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" className="flex-1 px-4 py-2.5 bg-trust-accent text-white rounded-lg text-sm font-medium hover:bg-trust-accent-hover transition-colors">
                Guardar Cambios
              </button>
              <button type="button" onClick={onCancel} className="px-4 py-2.5 bg-gray-100 text-trust-muted rounded-lg text-sm hover:text-trust-dark transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ─── Bulk import mode ─────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white border border-trust-border rounded-2xl w-full max-w-2xl p-6 shadow-trust-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-trust-dark mb-1">Agregar Cuentas de Instagram</h3>
        <p className="text-trust-muted text-sm mb-5">
          Cada cuenta crea un navegador independiente con sesion aislada
        </p>

        <div className="border border-trust-accent/20 rounded-xl p-4 bg-trust-accent/[0.03] mb-4">
          <h4 className="text-sm font-semibold text-trust-accent mb-2 flex items-center gap-2">
            {IG_ICON} Pega tus cuentas (una por linea)
          </h4>
          <p className="text-xs text-trust-muted mb-2">
            Formato completo: <code className="bg-trust-accent/10 text-trust-accent px-1.5 py-0.5 rounded font-medium">usuario|password|2FA_secret|email|email_pass</code>
          </p>
          <p className="text-xs text-trust-muted mb-3">
            Formato simple: <code className="bg-gray-100 px-1.5 py-0.5 rounded">usuario/password</code> o <code className="bg-gray-100 px-1.5 py-0.5 rounded">usuario,password</code>
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={`DannyCollins|Lol48ngdp@7AC|5ZKSD3LECYNXTCMZ|danny@outlook.com|pass123\nusuario2|mipass456|ABC123SECRET|email2@gmail.com|emailpass\ncuenta_simple/password123`}
            rows={8}
            className={INPUT_CLASS + ' font-mono resize-none'}
          />
          <div className="flex items-center gap-3 mt-3">
            <button onClick={parseBulk} className="px-4 py-2 bg-trust-accent text-white rounded-lg text-sm font-medium hover:bg-trust-accent-hover transition-colors">
              Detectar Cuentas
            </button>
            <span className="text-xs text-trust-muted">
              {bulkText.split('\n').filter((l) => l.trim()).length} linea(s)
            </span>
          </div>
        </div>

        <div className="mb-4">
          <label className={LABEL_CLASS}>Zona horaria (para todas)</label>
          <select value={bulkTimezone} onChange={(e) => setBulkTimezone(e.target.value)} className={INPUT_CLASS}>
            {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
          </select>
        </div>

        {bulkParsed.length > 0 && (
          <div className="border border-trust-border rounded-xl overflow-hidden mb-4 shadow-trust">
            <div className="px-4 py-2.5 bg-trust-surface border-b border-trust-border flex items-center justify-between">
              <span className="text-sm font-semibold text-trust-green">
                {bulkParsed.length} cuenta{bulkParsed.length !== 1 ? 's' : ''} detectada{bulkParsed.length !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-trust-muted">
                = {bulkParsed.length} navegador{bulkParsed.length !== 1 ? 'es' : ''}
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto divide-y divide-trust-border">
              {bulkParsed.map((acc, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-trust-surface transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-trust-muted w-6 text-right font-medium shrink-0">{i + 1}.</span>
                    <span className="text-sm text-trust-accent font-medium shrink-0">@{acc.user}</span>
                    <span className="text-xs text-trust-muted font-mono shrink-0">{'*'.repeat(Math.min(acc.pass.length, 6))}</span>
                    {acc.twofa && <span className="text-[10px] px-1.5 py-0.5 rounded bg-trust-green/10 text-trust-green font-medium shrink-0">2FA</span>}
                    {acc.email && <span className="text-[10px] text-trust-muted truncate max-w-[120px]">{acc.email}</span>}
                  </div>
                  <button onClick={() => removeParsed(i)} className="text-trust-muted hover:text-trust-red transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          {bulkParsed.length > 0 && (
            <button
              onClick={handleBulkImport}
              disabled={bulkLoading}
              className="flex-1 px-4 py-2.5 bg-trust-green text-white rounded-lg text-sm font-medium hover:bg-trust-green/90 transition-colors disabled:opacity-50"
            >
              {bulkLoading ? `Creando ${bulkParsed.length} perfiles...` : `Crear ${bulkParsed.length} Perfil${bulkParsed.length !== 1 ? 'es' : ''}`}
            </button>
          )}
          <button onClick={onCancel} className="px-4 py-2.5 bg-gray-100 text-trust-muted rounded-lg text-sm hover:text-trust-dark transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
