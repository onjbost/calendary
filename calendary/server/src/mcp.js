import crypto from 'node:crypto';
import { config } from './config.js';
import * as notes from './notes.js';
import { broadcast } from './stream.js';
import { httpError } from './util.js';

// MCP server ("Model Context Protocol", Streamable HTTP, stateless): lets Claude read and write the notes.
// "Annotalo su Calendary" → add_note in the project's folder. Scope: notes and folders only.
//
// Connect it as a custom connector on claude.ai: https://<public_url>/api/mcp/<mcp_token>
// or from Claude Code: claude mcp add --transport http calendary https://<public_url>/api/mcp --header "Authorization: Bearer <mcp_token>"

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MIN_TOKEN = 24;

export const mcpEnabled = () => config.mcpToken.length >= MIN_TOKEN;

function tokenMatches(candidate) {
  if (!mcpEnabled() || !candidate) return false;
  const a = crypto.createHash('sha256').update(String(candidate)).digest();
  const b = crypto.createHash('sha256').update(config.mcpToken).digest();
  return crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ tools

const folderRef = { type: 'string', description: 'Cartella (progetto): nome, es. "Calendary", oppure id' };

const TOOLS = [
  {
    name: 'list_note_folders',
    title: 'Elenca le cartelle delle note',
    description: 'Elenca le cartelle (una per progetto) con descrizione e numero di note aperte. Usalo prima di add_note per scegliere la cartella giusta.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_note_folder',
    title: 'Crea una cartella',
    description: 'Crea una cartella per un progetto (es. "Calendary", "Moveo").',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome del progetto' },
        description: { type: 'string', description: 'A cosa serve la cartella' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_notes',
    title: 'Elenca le note',
    description: 'Elenca le note, di una cartella o di tutte. Di default solo quelle ancora da fare.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: folderRef,
        include_done: { type: 'boolean', description: 'Includi anche le note completate' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_note',
    title: 'Aggiungi una nota',
    description: 'Aggiunge una nota su Calendary, per esempio una modifica o un aggiornamento da fare in futuro a un\'app. '
      + 'Dai sempre un titolo breve e una descrizione chiara e autonoma (cosa fare, perché, dove nel codice se noto). '
      + 'Se la cartella del progetto non esiste viene creata.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { ...folderRef, description: 'Progetto a cui si riferisce la nota, es. "Calendary". Creata se manca.' },
        title: { type: 'string', description: 'Titolo breve (max ~80 caratteri)' },
        description: { type: 'string', description: 'Descrizione dettagliata' },
        pinned: { type: 'boolean', description: 'Fissa la nota in cima' },
      },
      required: ['folder', 'title', 'description'],
    },
  },
  {
    name: 'update_note',
    title: 'Modifica una nota',
    description: 'Modifica una nota esistente: titolo, descrizione, cartella, oppure la segna come fatta.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        folder: folderRef,
        done: { type: 'boolean' },
        pinned: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
];

const noteView = (n, folders) => ({
  id: n.id,
  title: n.title,
  description: n.text,
  folder: folders.get(n.folderId)?.name || null,
  done: n.done,
  pinned: n.pinned,
  updatedAt: n.updatedAt,
});

function needFolder(ref) {
  const f = notes.findFolder(ref);
  if (!f) throw httpError(400, `Cartella "${ref}" non trovata: usa list_note_folders o create_note_folder`);
  return f;
}

function callTool(name, args = {}) {
  const folders = () => new Map(notes.listFolders().map((f) => [f.id, f]));
  switch (name) {
    case 'list_note_folders':
      return { folders: notes.listFolders().map((f) => ({ id: f.id, name: f.name, description: f.description, open: f.open, total: f.count })) };
    case 'create_note_folder': {
      const f = notes.createFolder({ name: args.name, description: args.description });
      broadcast('notes');
      return { folder: { id: f.id, name: f.name, description: f.description } };
    }
    case 'list_notes': {
      const f = args.folder ? needFolder(args.folder) : null;
      const list = notes.listNotes({ folderId: f?.id }).filter((n) => args.include_done || !n.done);
      const map = folders();
      return { notes: list.map((n) => noteView(n, map)) };
    }
    case 'add_note': {
      const title = String(args.title || '').trim();
      if (!title) throw httpError(400, 'Serve un titolo');
      let f = notes.findFolder(args.folder);
      let created = false;
      if (!f && args.folder) {
        f = notes.createFolder({ name: args.folder });
        created = true;
      }
      const n = notes.createNote({ title, text: args.description || '', folderId: f?.id || null, pinned: !!args.pinned }, { source: 'claude' });
      broadcast('notes');
      return { note: noteView(n, folders()), folderCreated: created };
    }
    case 'update_note': {
      const patch = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.description !== undefined) patch.text = args.description;
      if (args.done !== undefined) patch.done = !!args.done;
      if (args.pinned !== undefined) patch.pinned = !!args.pinned;
      if (args.folder !== undefined) patch.folderId = args.folder ? needFolder(args.folder).id : null;
      const n = notes.updateNote(String(args.id || ''), patch);
      broadcast('notes');
      return { note: noteView(n, folders()) };
    }
    default:
      throw Object.assign(new Error(`Strumento sconosciuto: ${name}`), { rpcCode: -32602 });
  }
}

// --------------------------------------------------------------- JSON-RPC

const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Handles one JSON-RPC message; returns the response, or null for notifications. */
export function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Richiesta non valida');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null; // notifications/initialized, notifications/cancelled…
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return result(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'calendary', title: 'Calendary', version: '0.8.0' },
        instructions: 'Note di Calendary raggruppate in cartelle per progetto. Quando l\'utente dice "annotalo su Calendary", '
          + 'usa add_note con la cartella del progetto di cui si sta parlando, un titolo breve e una descrizione chiara.',
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      try {
        const data = callTool(params.name, params.arguments || {});
        return result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false });
      } catch (err) {
        if (err.rpcCode) return rpcError(id, err.rpcCode, err.message);
        // tool errors go back to the model as results, so it can correct itself
        return result(id, { content: [{ type: 'text', text: err.message }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Metodo non supportato: ${method}`);
  }
}

// ------------------------------------------------------------------ route

export async function registerMcp(app) {
  const handler = async (req, reply) => {
    if (!mcpEnabled()) return reply.code(404).send({ error: 'Server MCP disattivato: imposta mcp_token (almeno 24 caratteri)' });
    const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null;
    if (!tokenMatches(req.params.token || bearer)) return reply.code(401).send({ error: 'Token MCP non valido' });
    if (req.method === 'GET') return reply.code(405).header('allow', 'POST').send({ error: 'Usa POST (Streamable HTTP, senza sessione)' });
    if (req.method === 'DELETE') return reply.code(204).send();
    const body = req.body;
    if (Array.isArray(body)) {
      const out = body.map(handleMessage).filter(Boolean);
      return out.length ? out : reply.code(202).send();
    }
    const res = handleMessage(body);
    if (!res) return reply.code(202).send();
    return res;
  };
  for (const url of ['/mcp', '/mcp/:token']) app.route({ method: ['GET', 'POST', 'DELETE'], url, handler });
}
