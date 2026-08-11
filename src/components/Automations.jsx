import React, { useState, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// ACTIONS REGISTRY
// ---------------------------------------------------------------------------
const ACTIONS = [
  { id: 'like', name: 'Like en Perfil', icon: '♥', color: 'text-red-500', desc: 'Dar likes a posts de un perfil' },
  { id: 'like-hashtag', name: 'Like x Hashtag', icon: '#♥', color: 'text-red-400', desc: 'Buscar hashtag y dar likes' },
  { id: 'like-feed', name: 'Like en Feed', icon: '♡', color: 'text-pink-400', desc: 'Dar likes a posts de tu feed' },
  { id: 'like-explore', name: 'Like Explorar', icon: '☆', color: 'text-purple-500', desc: 'Dar likes en Explorar' },
  { id: 'follow', name: 'Follow Perfil', icon: '+', color: 'text-trust-accent', desc: 'Seguir seguidores de un perfil' },
  { id: 'follow-hashtag', name: 'Follow x Hashtag', icon: '#+', color: 'text-blue-400', desc: 'Seguir autores de un hashtag' },
  { id: 'unfollow', name: 'Unfollow', icon: '−', color: 'text-orange-500', desc: 'Dejar de seguir cuentas' },
  { id: 'watch-reels', name: 'Ver Reels', icon: '▶', color: 'text-fuchsia-500', desc: 'Ver reels automaticamente' },
  { id: 'stories', name: 'Ver Stories', icon: '◎', color: 'text-pink-500', desc: 'Ver historias' },
  { id: 'visit', name: 'Visitar Perfiles', icon: '👁', color: 'text-cyan-600', desc: 'Visitar lista de perfiles' },
  { id: 'comment', name: 'Comentar', icon: '💬', color: 'text-trust-yellow', desc: 'Comentar en posts' },
  { id: 'send-dm', name: 'Enviar DM', icon: '✉', color: 'text-green-500', desc: 'Enviar mensaje directo' },
  { id: 'upload-post', name: 'Subir Post', icon: '↑', color: 'text-indigo-500', desc: 'Subir foto/video' },
  { id: 'edit-profile', name: 'Editar Perfil', icon: 'Aa', color: 'text-teal-500', desc: 'Cambiar foto, nombre, bio y website' },
  { id: 'share-post', name: 'Compartir Post', icon: '↪', color: 'text-sky-500', desc: 'Compartir post via DM' },
  { id: 'buff-post', name: 'Buff Post', icon: '⬆', color: 'text-amber-500', desc: 'Like/comment desde todas las cuentas' },
  { id: 'follow-suggestions', name: 'Follow Sugeridos', icon: '✦', color: 'text-violet-500', desc: 'Seguir cuentas sugeridas' },
  { id: 'search-follow', name: 'Buscar y Seguir', icon: '⌕', color: 'text-emerald-500', desc: 'Buscar keyword y seguir' },
  { id: 'extract', name: 'Extraer Seguidores', icon: '#', color: 'text-trust-accent', desc: 'Extraer lista de seguidores' },
];

// ---------------------------------------------------------------------------
// FIELD DEFINITIONS PER ACTION
// ---------------------------------------------------------------------------
const ACTION_FIELDS = {
  'like': [
    { key: 'targetUser', label: 'Perfil objetivo', type: 'text', placeholder: '@usuario' },
    { key: 'maxLikes', label: 'Max likes', type: 'number', min: 1, max: 100, default: 10 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 3 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 10 },
  ],
  'like-hashtag': [
    { key: 'hashtag', label: 'Hashtag', type: 'text', placeholder: '#marketing' },
    { key: 'maxLikes', label: 'Max likes', type: 'number', min: 1, max: 100, default: 15 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 3 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 10 },
  ],
  'like-feed': [
    { key: 'maxLikes', label: 'Max likes', type: 'number', min: 1, max: 100, default: 15 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 5 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 15 },
  ],
  'like-explore': [
    { key: 'maxLikes', label: 'Max likes', type: 'number', min: 1, max: 100, default: 15 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 3 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 10 },
  ],
  'follow': [
    { key: 'targetUser', label: 'Perfil objetivo', type: 'text', placeholder: '@usuario' },
    { key: 'maxFollows', label: 'Max follows', type: 'number', min: 1, max: 100, default: 20 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 5 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 15 },
    { key: 'source', label: 'Seguir desde', type: 'select', options: [{ value: 'followers', label: 'Seguidores del perfil' }, { value: 'following', label: 'Seguidos del perfil' }], default: 'followers' },
  ],
  'follow-hashtag': [
    { key: 'hashtag', label: 'Hashtag', type: 'text', placeholder: '#marketing' },
    { key: 'maxFollows', label: 'Max follows', type: 'number', min: 1, max: 100, default: 10 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 5 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 15 },
  ],
  'unfollow': [
    { key: 'maxUnfollows', label: 'Max unfollows', type: 'number', min: 1, max: 100, default: 10 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 5 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 15 },
    { key: 'onlyNonFollowers', label: 'Solo quienes no me siguen', type: 'checkbox', default: false },
  ],
  'watch-reels': [
    { key: 'maxReels', label: 'Cantidad de reels', type: 'number', min: 1, max: 50, default: 15 },
    { key: 'likeReels', label: 'Dar like a los reels', type: 'checkbox', default: false },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 5 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 15 },
  ],
  'stories': [
    { key: 'targetUser', label: 'Usuario (vacio = feed)', type: 'text', placeholder: '@usuario' },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 3 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 8 },
  ],
  'visit': [
    { key: 'usernames', label: 'Perfiles a visitar (uno por linea)', type: 'textarea', placeholder: '@usuario1\n@usuario2\n@usuario3', rows: 5 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 3 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 8 },
  ],
  'comment': [
    { key: 'targetUser', label: 'Perfil objetivo', type: 'text', placeholder: '@usuario' },
    { key: 'useAI', label: 'Generar comentarios con IA', type: 'checkbox', default: false },
    { key: 'aiApiKey', label: 'API Key (OpenAI o Anthropic)', type: 'text', placeholder: 'sk-...', mono: true, showIf: 'useAI' },
    { key: 'aiProvider', label: 'Proveedor IA', type: 'select', options: [{ value: 'openai', label: 'OpenAI (GPT)' }, { value: 'anthropic', label: 'Anthropic (Claude)' }, { value: 'gemini', label: 'Google (Gemini)' }], default: 'openai', showIf: 'useAI' },
    { key: 'aiPrompt', label: 'Instruccion para la IA', type: 'textarea', placeholder: 'Genera un comentario corto, positivo y natural para un post de Instagram sobre {tema}. Maximo 1 frase. No uses emojis excesivos. Varia el estilo.', rows: 3, showIf: 'useAI' },
    { key: 'aiLanguage', label: 'Idioma', type: 'select', options: [{ value: 'es', label: 'Español' }, { value: 'en', label: 'Ingles' }, { value: 'pt', label: 'Portugues' }], default: 'es', showIf: 'useAI' },
    { key: 'comments', label: 'Comentarios manuales (uno por linea, se elige al azar)', type: 'textarea', placeholder: 'Que buena foto!\nMe encanta\nIncreible contenido', rows: 5, hideIf: 'useAI' },
    { key: 'maxComments', label: 'Max comentarios', type: 'number', min: 1, max: 50, default: 5 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 10 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 30 },
  ],
  'send-dm': [
    { key: 'dmUsers', label: 'Usuarios (uno por linea)', type: 'textarea', placeholder: '@usuario1\n@usuario2', rows: 5 },
    { key: 'useAI', label: 'Generar mensaje con IA', type: 'checkbox', default: false },
    { key: 'aiApiKey', label: 'API Key (OpenAI o Anthropic)', type: 'text', placeholder: 'sk-...', mono: true, showIf: 'useAI' },
    { key: 'aiProvider', label: 'Proveedor IA', type: 'select', options: [{ value: 'openai', label: 'OpenAI (GPT)' }, { value: 'anthropic', label: 'Anthropic (Claude)' }, { value: 'gemini', label: 'Google (Gemini)' }], default: 'openai', showIf: 'useAI' },
    { key: 'aiPrompt', label: 'Instruccion para la IA', type: 'textarea', placeholder: 'Genera un DM personalizado para {nombre}. Tono amigable, profesional. Ofrecele {producto}. Maximo 2 frases.', rows: 3, showIf: 'useAI' },
    { key: 'dmMessage', label: 'Mensaje manual (usa {nombre} como variable)', type: 'textarea', placeholder: 'Hola {nombre}! Me interesa tu contenido...', rows: 3, hideIf: 'useAI' },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 15 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 45 },
  ],
  'upload-post': [
    { key: 'imagePath', label: 'Imagen / Video', type: 'file' },
    { key: 'caption', label: 'Caption/Descripcion', type: 'textarea', placeholder: 'Escribe el caption del post...', rows: 3 },
  ],
  'edit-profile': [
    { key: 'photoFolder', label: 'Carpeta de fotos de perfil', type: 'folder', placeholder: 'Elige una carpeta con varias fotos', hint: 'Cada cuenta agarra una foto DISTINTA al azar de la carpeta. Deja vacio para no cambiar la foto.' },
    { key: 'names', label: 'Nombres (uno por linea, se elige al azar)', type: 'textarea', placeholder: 'Maria Lopez\nCarlos Ruiz\nAna Torres', rows: 4, hint: 'Cada cuenta agarra un nombre distinto. Deja vacio para no cambiar el nombre.' },
    { key: 'bios', label: 'Bios (una por linea, se elige al azar)', type: 'textarea', placeholder: 'Amante del cafe ☕\nViajera 🌎\nEmprendedora', rows: 4, hint: 'Cada cuenta agarra una bio distinta. Deja vacio para no cambiar la bio.' },
    { key: 'newWebsite', label: 'Website (igual para todas)', type: 'text', placeholder: 'https://... (opcional)' },
  ],
  'share-post': [
    { key: 'postUrl', label: 'URL del post', type: 'text', placeholder: 'https://www.instagram.com/p/...', mono: true },
    { key: 'shareUsers', label: 'Usuarios (uno por linea)', type: 'textarea', placeholder: '@usuario1\n@usuario2', rows: 4 },
  ],
  'buff-post': [
    { key: 'postUrl', label: 'URL del post', type: 'text', placeholder: 'https://www.instagram.com/p/...', mono: true },
    { key: 'buffAction', label: 'Accion de buff', type: 'select', options: [{ value: 'like', label: 'Solo Like' }, { value: 'comment', label: 'Solo Comentar' }, { value: 'both', label: 'Like + Comentar' }], default: 'like' },
    { key: 'buffComment', label: 'Comentario para buff', type: 'text', placeholder: 'Increible contenido!' },
  ],
  'follow-suggestions': [
    { key: 'maxFollows', label: 'Max follows', type: 'number', min: 1, max: 100, default: 10 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 5 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 15 },
  ],
  'search-follow': [
    { key: 'keyword', label: 'Keyword de busqueda', type: 'text', placeholder: 'marketing digital' },
    { key: 'maxFollows', label: 'Max follows', type: 'number', min: 1, max: 100, default: 10 },
    { key: 'delayMin', label: 'Delay minimo (seg)', type: 'number', min: 1, max: 120, default: 5 },
    { key: 'delayMax', label: 'Delay maximo (seg)', type: 'number', min: 1, max: 120, default: 15 },
  ],
  'extract': [
    { key: 'targetUsers', label: 'Cuentas a extraer (una por linea)', type: 'textarea', placeholder: '@cuenta1\n@cuenta2\n@influencer', rows: 5 },
    { key: 'maxFollowers', label: 'Max seguidores por cuenta', type: 'number', min: 100, max: 10000, default: 200 },
  ],
};

// ---------------------------------------------------------------------------
// STYLE CONSTANTS
// ---------------------------------------------------------------------------
const INPUT_CLASS = 'w-full bg-trust-surface border border-trust-border rounded-lg px-3 py-2.5 text-trust-dark text-sm focus:outline-none focus:border-trust-accent focus:ring-1 focus:ring-trust-accent/20';
const LABEL_CLASS = 'block text-xs text-trust-muted font-medium mb-1.5';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const PIPELINES_KEY = 'trustmind_pipelines';

function loadPipelines() {
  try {
    return JSON.parse(window.localStorage.getItem(PIPELINES_KEY) || '[]');
  } catch { return []; }
}

function savePipelines(pipelines) {
  window.localStorage.setItem(PIPELINES_KEY, JSON.stringify(pipelines));
}

function getDefaultConfig(actionId) {
  const fields = ACTION_FIELDS[actionId] || [];
  const cfg = {};
  for (const f of fields) {
    if (f.default !== undefined) cfg[f.key] = f.default;
  }
  return cfg;
}

function getActionById(id) {
  return ACTIONS.find((a) => a.id === id);
}

/** Build the config object to send to the existing window.api methods */
function buildApiConfig(actionId, cfg) {
  const c = { ...cfg };
  // Strip @ from user fields
  if (c.targetUser) c.targetUser = c.targetUser.replace(/^@/, '');
  if (c.hashtag) c.hashtag = c.hashtag.replace(/^#/, '');
  // Parse numbers
  for (const k of ['maxLikes', 'maxFollows', 'maxUnfollows', 'maxReels', 'maxComments', 'maxFollowers', 'delayMin', 'delayMax']) {
    if (c[k] !== undefined) c[k] = parseInt(c[k]) || 0;
  }
  // Parse textareas into arrays where needed
  if (c.targetUsers && typeof c.targetUsers === 'string') c.targetUsers = c.targetUsers.split('\n').map((u) => u.trim().replace(/^@/, '')).filter(Boolean);
  if (c.usernames && typeof c.usernames === 'string') c.usernames = c.usernames.split('\n').map((u) => u.trim()).filter(Boolean);
  if (c.comments && typeof c.comments === 'string') c.comments = c.comments.split('\n').filter((x) => x.trim());
  if (c.dmUsers && typeof c.dmUsers === 'string') c.targetUsers = c.dmUsers.split('\n').filter((u) => u.trim());
  if (c.shareUsers && typeof c.shareUsers === 'string') c.targetUsers = c.shareUsers.split('\n').filter((u) => u.trim());
  return c;
}

/** Execute a single action on a single profile, using the existing API surface */
async function executeAction(profileId, actionId, rawConfig) {
  const c = buildApiConfig(actionId, rawConfig);
  switch (actionId) {
    case 'extract': {
      const targets = Array.isArray(c.targetUsers) ? c.targetUsers : [];
      for (const target of targets) {
        await window.api.extractFollowers(profileId, { targetUser: target, maxFollowers: c.maxFollowers || 200 });
      }
      return;
    }
    case 'like': return window.api.autoLike(profileId, { targetUser: c.targetUser, maxLikes: c.maxLikes || 10, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'like-hashtag': return window.api.likeByHashtag(profileId, { hashtag: c.hashtag, maxLikes: c.maxLikes || 15, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'like-feed': return window.api.likeFeed(profileId, { maxLikes: c.maxLikes || 15, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'like-explore': return window.api.likeExplore(profileId, { maxLikes: c.maxLikes || 15, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'follow': return window.api.autoFollow(profileId, { targetUser: c.targetUser, maxFollows: c.maxFollows || 10, source: c.source || 'followers', delayMin: c.delayMin, delayMax: c.delayMax });
    case 'follow-hashtag': return window.api.followByHashtag(profileId, { hashtag: c.hashtag, maxFollows: c.maxFollows || 10, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'unfollow': return window.api.autoUnfollow(profileId, { maxUnfollows: c.maxUnfollows || 10, onlyNonFollowers: c.onlyNonFollowers || false, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'watch-reels': return window.api.watchReels(profileId, { maxReels: c.maxReels || 20, likeReels: c.likeReels || false, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'stories': return window.api.autoViewStories(profileId, { targetUser: c.targetUser, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'visit': return window.api.autoVisitProfiles(profileId, { usernames: c.usernames || [], delayMin: c.delayMin, delayMax: c.delayMax });
    case 'comment': return window.api.autoComment(profileId, { targetUser: c.targetUser, comments: c.comments || [], maxComments: c.maxComments || 5, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'send-dm': return window.api.sendDM(profileId, { targetUsers: c.targetUsers || [], message: c.dmMessage || '', delayMin: c.delayMin, delayMax: c.delayMax });
    case 'upload-post': return window.api.uploadPost(profileId, { imagePath: c.imagePath || '', caption: c.caption || '' });
    case 'edit-profile': return window.api.editProfileIG(profileId, { photoFolder: c.photoFolder || '', names: c.names || '', bios: c.bios || '', newWebsite: c.newWebsite || '' });
    case 'share-post': return window.api.sharePost(profileId, { postUrl: c.postUrl || '', targetUsers: c.targetUsers || [] });
    case 'buff-post': return window.api.buffPost(profileId, { postUrl: c.postUrl || '', action: c.buffAction || 'like', comment: c.buffComment || '' });
    case 'follow-suggestions': return window.api.followSuggestions(profileId, { maxFollows: c.maxFollows || 10, delayMin: c.delayMin, delayMax: c.delayMax });
    case 'search-follow': return window.api.searchAndFollow(profileId, { keyword: c.keyword || '', maxFollows: c.maxFollows || 10, delayMin: c.delayMin, delayMax: c.delayMax });
    default: return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
// ---------------------------------------------------------------------------

/** Renders config fields for one action */
function ConfigFields({ actionId, config, onChange }) {
  const fields = ACTION_FIELDS[actionId] || [];
  const update = (key, val) => onChange({ ...config, [key]: val });

  return (
    <div className="space-y-3">
      {fields.map((f) => {
        // Conditional visibility: showIf means only show when that config key is truthy
        if (f.showIf && !config[f.showIf]) return null;
        // hideIf means hide when that config key is truthy
        if (f.hideIf && config[f.hideIf]) return null;

        if (f.type === 'checkbox') {
          return (
            <div key={f.key} className="flex items-center gap-3">
              <input type="checkbox" checked={config[f.key] || false} onChange={(e) => update(f.key, e.target.checked)} className="accent-trust-accent w-4 h-4" />
              <label className="text-sm text-trust-dark">{f.label}</label>
            </div>
          );
        }
        if (f.type === 'select') {
          return (
            <div key={f.key}>
              <label className={LABEL_CLASS}>{f.label}</label>
              <select value={config[f.key] || f.default || ''} onChange={(e) => update(f.key, e.target.value)} className={INPUT_CLASS}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          );
        }
        if (f.type === 'file') {
          return (
            <div key={f.key}>
              <label className={LABEL_CLASS}>{f.label}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config[f.key] || ''}
                  onChange={(e) => update(f.key, e.target.value)}
                  placeholder={f.placeholder || 'Ningun archivo seleccionado'}
                  className={INPUT_CLASS + ' font-mono text-xs'}
                />
                <button
                  type="button"
                  onClick={async () => {
                    const paths = await window.api.selectFiles?.({ multiple: !!f.multiple });
                    if (paths && paths.length) update(f.key, paths.join(', '));
                  }}
                  className="px-4 py-2 bg-trust-accent text-white rounded-lg text-sm font-medium hover:bg-trust-accent-hover transition-colors shrink-0"
                >
                  {f.multiple ? 'Seleccionar archivos' : 'Seleccionar archivo'}
                </button>
              </div>
            </div>
          );
        }
        if (f.type === 'folder') {
          return (
            <div key={f.key}>
              <label className={LABEL_CLASS}>{f.label}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config[f.key] || ''}
                  onChange={(e) => update(f.key, e.target.value)}
                  placeholder={f.placeholder || ''}
                  className={INPUT_CLASS + ' flex-1'}
                />
                <button
                  type="button"
                  onClick={async () => { const dir = await window.api.selectFolder?.(); if (dir) update(f.key, dir); }}
                  className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap bg-trust-surface border border-trust-border text-trust-text hover:border-trust-accent"
                >📁 Elegir carpeta</button>
              </div>
              {f.hint && <p className="text-xs text-trust-muted mt-1">{f.hint}</p>}
            </div>
          );
        }
        if (f.type === 'textarea') {
          return (
            <div key={f.key}>
              <label className={LABEL_CLASS}>{f.label}</label>
              <textarea
                value={config[f.key] || ''}
                onChange={(e) => update(f.key, e.target.value)}
                placeholder={f.placeholder || ''}
                rows={f.rows || 3}
                className={INPUT_CLASS + ' resize-none' + (f.mono ? ' font-mono' : '')}
              />
              {f.hint && <p className="text-xs text-trust-muted mt-1">{f.hint}</p>}
            </div>
          );
        }
        if (f.type === 'number') {
          return (
            <div key={f.key}>
              <label className={LABEL_CLASS}>{f.label}</label>
              <input
                type="number"
                value={config[f.key] ?? f.default ?? ''}
                onChange={(e) => update(f.key, e.target.value)}
                min={f.min}
                max={f.max}
                className={INPUT_CLASS}
              />
            </div>
          );
        }
        // text
        return (
          <div key={f.key}>
            <label className={LABEL_CLASS}>{f.label}</label>
            <input
              type="text"
              value={config[f.key] || ''}
              onChange={(e) => update(f.key, e.target.value)}
              placeholder={f.placeholder || ''}
              className={INPUT_CLASS + (f.mono ? ' font-mono' : '')}
            />
          </div>
        );
      })}
    </div>
  );
}

/** A brief summary string for a pipeline step */
function stepSummary(actionId, cfg) {
  const parts = [];
  if (cfg.targetUser) parts.push(`@${cfg.targetUser.replace(/^@/, '')}`);
  if (cfg.hashtag) parts.push(cfg.hashtag.startsWith('#') ? cfg.hashtag : `#${cfg.hashtag}`);
  if (cfg.keyword) parts.push(`"${cfg.keyword}"`);
  if (cfg.maxLikes) parts.push(`${cfg.maxLikes} likes`);
  if (cfg.maxFollows) parts.push(`${cfg.maxFollows} follows`);
  if (cfg.maxUnfollows) parts.push(`${cfg.maxUnfollows} unfollows`);
  if (cfg.maxReels) parts.push(`${cfg.maxReels} reels`);
  if (cfg.maxComments) parts.push(`${cfg.maxComments} comments`);
  if (cfg.maxFollowers) parts.push(`max ${cfg.maxFollowers}`);
  if (cfg.delayMin && cfg.delayMax) parts.push(`delay ${cfg.delayMin}-${cfg.delayMax}s`);
  return parts.join(', ') || 'Sin configurar';
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------
export default function Automations({ tier, onUpgrade }) {
  // ---- Data state ----
  const [profiles, setProfiles] = useState([]);
  const [runningIds, setRunningIds] = useState([]);
  const [selectedProfiles, setSelectedProfiles] = useState([]);
  const [autoStatus, setAutoStatus] = useState({});

  // ---- Mode ----
  const [mode, setMode] = useState('simple'); // 'simple' | 'pipeline'

  // ---- Simple mode state ----
  const [selectedAction, setSelectedAction] = useState(null);
  const [config, setConfig] = useState({});

  // ---- Pipeline mode state ----
  const [pipelineSteps, setPipelineSteps] = useState([]);
  const [expandedStep, setExpandedStep] = useState(null);
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [pipelineName, setPipelineName] = useState('');
  const [savedPipelines, setSavedPipelines] = useState([]);
  const [selectedPipelineIdx, setSelectedPipelineIdx] = useState(-1);

  // ---- Execution state ----
  const [running, setRunning] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);
  const cancelledRef = useRef(false);

  // ---- Load data ----
  useEffect(() => {
    loadData();
    setSavedPipelines(loadPipelines());
    const interval = setInterval(loadData, 3000);

    window.api.onAutomationEvent((event) => {
      const time = new Date().toLocaleTimeString();
      const { profileId, event: evt, data } = event;
      let msg = '';
      if (evt === 'start') msg = `Iniciando ${data.type}${data.target ? ` en @${data.target}` : ''}`;
      if (evt === 'progress') msg = `${data.type}: ${data.current}/${data.total}${data.currentUser ? ` → @${data.currentUser}` : ''}`;
      if (evt === 'done') {
        const count = data.likesGiven || data.followed || data.unfollowed || data.storiesViewed || data.visited || data.commented || 0;
        msg = `Completado: ${count} acciones`;
      }
      if (evt === 'error') msg = `Error: ${data.error}`;
      if (msg) {
        setLogs((prev) => [...prev.slice(-200), { time, msg, evt, profileId }]);
      }
    });

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const loadData = async () => {
    const data = await window.api.listProfiles();
    setProfiles(data);
    const status = await window.api.getBrowserStatus();
    setRunningIds(status);
    const aStatus = await window.api.getAutomationStatus();
    setAutoStatus(aStatus);
  };

  const activeProfiles = profiles.filter((p) => runningIds.includes(p.id));

  const toggleProfile = (id) => {
    setSelectedProfiles((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
  };
  const selectAll = () => setSelectedProfiles(profiles.map((p) => p.id));

  /** Ensure browsers are open for selected profiles, launching any that aren't */
  const ensureBrowsersOpen = async (profileIds) => {
    const status = await window.api.getBrowserStatus().catch(() => []);
    const needLaunch = profileIds.filter((id) => !status.includes(id));
    if (needLaunch.length > 0) {
      addLog(`Abriendo ${needLaunch.length} navegador(es)...`, 'info');
      for (const id of needLaunch) {
        try {
          await window.api.launchBrowser(id);
          addLog(`Navegador abierto para ${profiles.find((p) => p.id === id)?.name || id}`, 'info');
        } catch (err) {
          addLog(`Error abriendo navegador para ${profiles.find((p) => p.id === id)?.name || id}: ${err?.message || err}`, 'error');
        }
      }
      // Small wait for browsers to initialize
      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  // ---- Simple mode execution ----
  const handleRunSimple = async () => {
    if (!selectedAction || selectedProfiles.length === 0) return;
    setRunning(true);
    cancelledRef.current = false;
    addLog(`Ejecutando ${selectedAction.name} en ${selectedProfiles.length} perfil(es)...`, 'start');

    await ensureBrowsersOpen(selectedProfiles);
    if (cancelledRef.current) { setRunning(false); return; }

    const promises = selectedProfiles.map((pid) => executeAction(pid, selectedAction.id, config));
    const results = await Promise.allSettled(promises);
    checkProRequired(results);
    setRunning(false);
    loadData();
  };

  // ---- Pipeline execution ----
  const handleRunPipeline = async () => {
    if (pipelineSteps.length === 0 || selectedProfiles.length === 0) return;
    setRunning(true);
    cancelledRef.current = false;
    addLog(`Iniciando pipeline "${pipelineName || 'Sin nombre'}" con ${pipelineSteps.length} paso(s) en ${selectedProfiles.length} perfil(es)`, 'start');

    await ensureBrowsersOpen(selectedProfiles);
    if (cancelledRef.current) { setRunning(false); return; }

    for (let i = 0; i < pipelineSteps.length; i++) {
      if (cancelledRef.current) break;
      const step = pipelineSteps[i];
      const action = getActionById(step.actionId);
      setCurrentStepIdx(i);
      addLog(`--- Paso ${i + 1}/${pipelineSteps.length}: ${action?.name || step.actionId} ---`, 'start');

      // Check which profiles still have browsers open
      const browserStatus = await window.api.getBrowserStatus().catch(() => []);
      const activeProfiles = selectedProfiles.filter(id => browserStatus.includes(id));
      if (activeProfiles.length === 0) {
        addLog('No hay navegadores abiertos — pipeline detenido', 'error');
        break;
      }
      if (activeProfiles.length < selectedProfiles.length) {
        addLog(`${selectedProfiles.length - activeProfiles.length} perfil(es) sin navegador — se saltan`, 'warn');
      }

      for (const profileId of activeProfiles) {
        if (cancelledRef.current) break;
        try {
          const result = await executeAction(profileId, step.actionId, step.config);
          if (result?.error === 'PRO_REQUIRED' && onUpgrade) { onUpgrade(); cancelledRef.current = true; break; }
          if (result?.error) addLog(`${result.error}`, 'error');
        } catch (err) {
          if (err?.code === 'PRO_REQUIRED' && onUpgrade) { onUpgrade(); cancelledRef.current = true; break; }
          addLog(`Error: ${err?.message || err}`, 'error');
        }
      }

      // Small pause between pipeline steps
      if (i < pipelineSteps.length - 1 && !cancelledRef.current) {
        addLog('Esperando 3s antes del siguiente paso...', 'info');
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    setCurrentStepIdx(-1);
    setRunning(false);
    if (!cancelledRef.current) {
      addLog('Pipeline completado — cerrando navegadores...', 'done');
      // Close all browsers after pipeline completes
      for (const profileId of selectedProfiles) {
        try { await window.api.closeBrowser(profileId); } catch {}
      }
      addLog('Navegadores cerrados', 'done');
    }
    loadData();
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    for (const id of selectedProfiles) await window.api.cancelAutomation(id);
    setRunning(false);
    setCurrentStepIdx(-1);
    addLog('Automatizaciones canceladas', 'error');
  };

  // ---- Helpers ----
  function addLog(msg, evt) {
    setLogs((prev) => [...prev.slice(-200), { time: new Date().toLocaleTimeString(), msg, evt }]);
  }

  function checkProRequired(results) {
    const proRequired = results.some(
      (r) => (r.status === 'fulfilled' && r.value?.error === 'PRO_REQUIRED') ||
             (r.status === 'rejected' && r.reason?.code === 'PRO_REQUIRED')
    );
    if (proRequired && onUpgrade) onUpgrade();
  }

  // ---- Pipeline CRUD ----
  const addPipelineStep = (actionId) => {
    const newStep = { actionId, config: getDefaultConfig(actionId) };
    setPipelineSteps((prev) => [...prev, newStep]);
    setExpandedStep(pipelineSteps.length);
    setShowActionPicker(false);
  };

  const removePipelineStep = (idx) => {
    setPipelineSteps((prev) => prev.filter((_, i) => i !== idx));
    if (expandedStep === idx) setExpandedStep(null);
    else if (expandedStep > idx) setExpandedStep(expandedStep - 1);
  };

  const updateStepConfig = (idx, newConfig) => {
    setPipelineSteps((prev) => prev.map((s, i) => i === idx ? { ...s, config: newConfig } : s));
  };

  const moveStep = (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= pipelineSteps.length) return;
    setPipelineSteps((prev) => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
    if (expandedStep === idx) setExpandedStep(newIdx);
    else if (expandedStep === newIdx) setExpandedStep(idx);
  };

  const handleSavePipeline = () => {
    if (!pipelineName.trim() || pipelineSteps.length === 0) return;
    const pipeline = { name: pipelineName.trim(), steps: pipelineSteps };
    const existing = loadPipelines();
    const existIdx = existing.findIndex((p) => p.name === pipeline.name);
    if (existIdx >= 0) existing[existIdx] = pipeline;
    else existing.push(pipeline);
    savePipelines(existing);
    setSavedPipelines(existing);
    addLog(`Pipeline "${pipeline.name}" guardado`, 'done');
  };

  const handleLoadPipeline = (idx) => {
    const pipelines = loadPipelines();
    if (idx < 0 || idx >= pipelines.length) return;
    const p = pipelines[idx];
    setPipelineName(p.name);
    setPipelineSteps(p.steps);
    setExpandedStep(null);
    setSelectedPipelineIdx(idx);
    addLog(`Pipeline "${p.name}" cargado`, 'start');
  };

  const handleDeletePipeline = (idx) => {
    const pipelines = loadPipelines();
    const name = pipelines[idx]?.name;
    pipelines.splice(idx, 1);
    savePipelines(pipelines);
    setSavedPipelines(pipelines);
    setSelectedPipelineIdx(-1);
    addLog(`Pipeline "${name}" eliminado`, 'error');
  };

  // ---- RENDER ----
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-trust-dark mb-1">Automatizaciones</h2>
          <p className="text-trust-muted text-sm">Selecciona perfiles, elige acciones y ejecuta</p>
        </div>
        {/* Mode toggle */}
        <div className="flex bg-trust-surface border border-trust-border rounded-lg p-0.5">
          <button
            onClick={() => setMode('simple')}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'simple' ? 'bg-white text-trust-dark shadow-sm' : 'text-trust-muted hover:text-trust-dark'}`}
          >
            Simple
          </button>
          <button
            onClick={() => setMode('pipeline')}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'pipeline' ? 'bg-white text-trust-dark shadow-sm' : 'text-trust-muted hover:text-trust-dark'}`}
          >
            Pipeline
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* ================================================================ */}
        {/* LEFT SIDEBAR - Profile selector                                  */}
        {/* ================================================================ */}
        <div className="w-64 flex flex-col shrink-0">
          <div className="bg-white border border-trust-border rounded-xl p-4 shadow-trust">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-trust-dark">Perfiles</h3>
              {profiles.length > 0 && (
                <button onClick={selectAll} className="text-xs text-trust-accent font-medium hover:text-trust-accent-hover">Todos</button>
              )}
            </div>
            {profiles.length === 0 ? (
              <p className="text-xs text-trust-muted py-4 text-center">No hay perfiles creados</p>
            ) : (
              <div className="space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto">
                {profiles.map((p) => {
                  const isActive = runningIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                        selectedProfiles.includes(p.id)
                          ? 'bg-trust-accent/5 border border-trust-accent/30 shadow-sm'
                          : 'hover:bg-trust-surface border border-transparent'
                      }`}
                    >
                      <input type="checkbox" checked={selectedProfiles.includes(p.id)} onChange={() => toggleProfile(p.id)} className="accent-trust-accent w-4 h-4" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-trust-dark font-medium truncate">{p.name}</div>
                        {p.ig_user && <div className="text-xs text-trust-muted">@{p.ig_user}</div>}
                      </div>
                      {autoStatus[p.id] ? (
                        <span className="w-2 h-2 rounded-full bg-trust-yellow animate-pulse" title="Automatizacion en curso" />
                      ) : isActive ? (
                        <span className="w-2 h-2 rounded-full bg-green-500" title="Navegador abierto" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-trust-border" title="Navegador cerrado" />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {selectedProfiles.length > 0 && (
              <div className="mt-3 pt-3 border-t border-trust-border">
                <span className="text-xs text-trust-muted">{selectedProfiles.length} perfil{selectedProfiles.length !== 1 ? 'es' : ''} seleccionado{selectedProfiles.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* MAIN AREA                                                        */}
        {/* ================================================================ */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {mode === 'simple' ? (
            /* ---------- SIMPLE MODE ---------- */
            <>
              {/* Action grid */}
              <div className="bg-white border border-trust-border rounded-xl p-4 shadow-trust">
                <h3 className="text-sm font-semibold text-trust-dark mb-3">Selecciona una accion</h3>
                <div className="grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                  {ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => { setSelectedAction(action); setConfig(getDefaultConfig(action.id)); }}
                      className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all ${
                        selectedAction?.id === action.id
                          ? `bg-trust-accent/5 border-trust-accent/40 ${action.color} shadow-sm`
                          : 'border-trust-border text-trust-muted hover:text-trust-dark hover:border-trust-accent/30 hover:bg-trust-surface'
                      }`}
                    >
                      <span className="text-lg leading-none">{action.icon}</span>
                      <span className="text-[10px] font-semibold leading-tight">{action.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Config for selected action */}
              {selectedAction && (
                <div className="bg-white border border-trust-border rounded-xl p-5 shadow-trust">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-lg ${selectedAction.color}`}>{selectedAction.icon}</span>
                    <h3 className="text-sm font-bold text-trust-dark">{selectedAction.name}</h3>
                  </div>
                  <p className="text-xs text-trust-muted mb-4">{selectedAction.desc}</p>
                  <ConfigFields actionId={selectedAction.id} config={config} onChange={setConfig} />
                  <div className="flex gap-3 mt-5">
                    {!running ? (
                      <button
                        onClick={handleRunSimple}
                        disabled={selectedProfiles.length === 0}
                        className="flex-1 px-4 py-2.5 bg-trust-accent text-white rounded-lg text-sm font-bold hover:bg-trust-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-trust"
                      >
                        Ejecutar en {selectedProfiles.length} perfil{selectedProfiles.length !== 1 ? 'es' : ''}
                      </button>
                    ) : (
                      <button onClick={handleCancel} className="flex-1 px-4 py-2.5 bg-trust-red text-white rounded-lg text-sm font-bold hover:bg-trust-red/90 transition-colors">
                        Cancelar Todo
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ---------- PIPELINE MODE ---------- */
            <>
              {/* Pipeline header */}
              <div className="bg-white border border-trust-border rounded-xl p-4 shadow-trust">
                <div className="flex items-center gap-4">
                  {/* Pipeline name */}
                  <div className="flex-1">
                    <label className={LABEL_CLASS}>Nombre del pipeline</label>
                    <input
                      type="text"
                      value={pipelineName}
                      onChange={(e) => setPipelineName(e.target.value)}
                      placeholder="Mi pipeline de engagement..."
                      className={INPUT_CLASS}
                    />
                  </div>
                  {/* Load pipeline */}
                  <div className="w-52">
                    <label className={LABEL_CLASS}>Cargar guardado</label>
                    <div className="flex gap-1">
                      <select
                        value={selectedPipelineIdx}
                        onChange={(e) => setSelectedPipelineIdx(parseInt(e.target.value))}
                        className={INPUT_CLASS + ' flex-1'}
                      >
                        <option value={-1}>-- Seleccionar --</option>
                        {savedPipelines.map((p, i) => (
                          <option key={i} value={i}>{p.name} ({p.steps.length} pasos)</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 items-end pt-5">
                    <button
                      onClick={() => handleLoadPipeline(selectedPipelineIdx)}
                      disabled={selectedPipelineIdx < 0}
                      className="px-3 py-2.5 bg-trust-surface border border-trust-border text-trust-dark rounded-lg text-xs font-semibold hover:bg-trust-accent/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Cargar
                    </button>
                    <button
                      onClick={() => handleDeletePipeline(selectedPipelineIdx)}
                      disabled={selectedPipelineIdx < 0}
                      className="px-3 py-2.5 bg-trust-surface border border-trust-border text-trust-red rounded-lg text-xs font-semibold hover:bg-trust-red/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>

              {/* Pipeline steps list */}
              <div className="bg-white border border-trust-border rounded-xl shadow-trust flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-trust-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-trust-dark">
                    Pasos del Pipeline
                    {pipelineSteps.length > 0 && <span className="ml-2 text-trust-muted font-normal">({pipelineSteps.length})</span>}
                  </h3>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {pipelineSteps.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-3 opacity-20">+</div>
                      <p className="text-sm text-trust-muted">Agrega pasos al pipeline con el boton de abajo</p>
                    </div>
                  ) : (
                    pipelineSteps.map((step, idx) => {
                      const action = getActionById(step.actionId);
                      const isExpanded = expandedStep === idx;
                      const isRunningStep = running && currentStepIdx === idx;
                      return (
                        <div
                          key={idx}
                          className={`border rounded-xl transition-all ${
                            isRunningStep
                              ? 'border-trust-yellow bg-trust-yellow/5 shadow-md'
                              : isExpanded
                                ? 'border-trust-accent/40 bg-trust-accent/5'
                                : 'border-trust-border hover:border-trust-accent/30'
                          }`}
                        >
                          {/* Step header */}
                          <div
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedStep(isExpanded ? null : idx)}
                          >
                            {/* Step number */}
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                              isRunningStep ? 'bg-trust-yellow text-white animate-pulse' : 'bg-trust-accent/10 text-trust-accent'
                            }`}>
                              {idx + 1}
                            </div>
                            {/* Action icon + name */}
                            <span className={`text-base ${action?.color || ''}`}>{action?.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-trust-dark">{action?.name || step.actionId}</div>
                              <div className="text-xs text-trust-muted truncate">{stepSummary(step.actionId, step.config)}</div>
                            </div>
                            {/* Controls */}
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => moveStep(idx, -1)}
                                disabled={idx === 0}
                                className="w-7 h-7 rounded-lg text-trust-muted hover:text-trust-dark hover:bg-trust-surface transition-colors disabled:opacity-20 text-xs"
                                title="Mover arriba"
                              >
                                &#9650;
                              </button>
                              <button
                                onClick={() => moveStep(idx, 1)}
                                disabled={idx === pipelineSteps.length - 1}
                                className="w-7 h-7 rounded-lg text-trust-muted hover:text-trust-dark hover:bg-trust-surface transition-colors disabled:opacity-20 text-xs"
                                title="Mover abajo"
                              >
                                &#9660;
                              </button>
                              <button
                                onClick={() => removePipelineStep(idx)}
                                className="w-7 h-7 rounded-lg text-trust-red/60 hover:text-trust-red hover:bg-trust-red/5 transition-colors text-sm font-bold"
                                title="Eliminar paso"
                              >
                                &times;
                              </button>
                            </div>
                            {/* Expand arrow */}
                            <span className={`text-trust-muted text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>&#9660;</span>
                          </div>
                          {/* Expanded config */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-1 border-t border-trust-border/50">
                              <ConfigFields
                                actionId={step.actionId}
                                config={step.config}
                                onChange={(newCfg) => updateStepConfig(idx, newCfg)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Add step + action buttons */}
                <div className="px-4 py-3 border-t border-trust-border space-y-3">
                  {/* Action picker dropdown */}
                  {showActionPicker && (
                    <div className="bg-trust-surface border border-trust-border rounded-xl p-3 max-h-52 overflow-y-auto">
                      <div className="grid grid-cols-3 xl:grid-cols-4 gap-1.5">
                        {ACTIONS.map((action) => (
                          <button
                            key={action.id}
                            onClick={() => addPipelineStep(action.id)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-transparent text-left transition-all hover:border-trust-accent/30 hover:bg-white"
                          >
                            <span className={`text-sm ${action.color}`}>{action.icon}</span>
                            <span className="text-xs font-medium text-trust-dark truncate">{action.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowActionPicker(!showActionPicker)}
                      className="flex-1 px-4 py-2.5 bg-trust-surface border border-trust-border text-trust-dark rounded-lg text-sm font-semibold hover:bg-trust-accent/5 hover:border-trust-accent/30 transition-colors"
                    >
                      {showActionPicker ? 'Cerrar' : '+ Agregar Paso'}
                    </button>
                    <button
                      onClick={handleSavePipeline}
                      disabled={pipelineSteps.length === 0 || !pipelineName.trim()}
                      className="px-4 py-2.5 bg-trust-surface border border-trust-border text-trust-accent rounded-lg text-sm font-semibold hover:bg-trust-accent/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Guardar Pipeline
                    </button>
                    {!running ? (
                      <button
                        onClick={handleRunPipeline}
                        disabled={selectedProfiles.length === 0 || pipelineSteps.length === 0}
                        className="px-6 py-2.5 bg-trust-accent text-white rounded-lg text-sm font-bold hover:bg-trust-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-trust"
                      >
                        Ejecutar Pipeline
                      </button>
                    ) : (
                      <button
                        onClick={handleCancel}
                        className="px-6 py-2.5 bg-trust-red text-white rounded-lg text-sm font-bold hover:bg-trust-red/90 transition-colors"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ================================================================ */}
        {/* RIGHT PANEL - Activity Log                                       */}
        {/* ================================================================ */}
        <div className="w-72 shrink-0 flex flex-col">
          <div className="bg-white border border-trust-border rounded-xl flex-1 flex flex-col min-h-0 shadow-trust">
            <div className="px-4 py-3 border-b border-trust-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-trust-dark">Log de actividad</h3>
              {logs.length > 0 && (
                <button onClick={() => setLogs([])} className="text-xs text-trust-muted hover:text-trust-dark font-medium">Limpiar</button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 bg-trust-dark rounded-b-xl font-mono text-xs space-y-1">
              {logs.length === 0 ? (
                <p className="text-white/20 text-center py-8">Las acciones apareceran aqui...</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`flex gap-2 leading-relaxed ${
                    log.evt === 'error' ? 'text-red-400' : log.evt === 'done' ? 'text-green-400' : 'text-white/60'
                  }`}>
                    <span className="text-white/30 shrink-0">{log.time}</span>
                    <span>{log.msg}</span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
