import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendary-mcp-'));
process.env.DATA_DIR = tmp;
process.env.TZ_OVERRIDE = 'Europe/Rome';
process.env.CALENDARY_MCP_TOKEN = 'test-token-0123456789-abcdef';

const { handleMessage, mcpEnabled } = await import('../src/mcp.js');
const notes = await import('../src/notes.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let seq = 0;
const call = (name, args = {}) => handleMessage({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }).result;

describe('MCP server', () => {
  test('handshake and tool list', () => {
    assert.ok(mcpEnabled());
    const init = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.ok(init.result.capabilities.tools);
    assert.equal(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const names = handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools.map((t) => t.name);
    assert.deepEqual(names.sort(), ['add_note', 'create_note_folder', 'list_note_folders', 'list_notes', 'update_note']);
    assert.equal(handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' }).error.code, -32601);
  });

  test('"annotalo su Calendary": the project folder is created on the fly', () => {
    const r = call('add_note', { folder: 'Calendary', title: 'Scrittura a penna nelle note', description: 'Aggiungere un riquadro di disegno con la penna del tablet accanto alla tastiera.' });
    assert.equal(r.isError, false);
    assert.equal(r.structuredContent.folderCreated, true);
    assert.equal(r.structuredContent.note.folder, 'Calendary');
    const again = call('add_note', { folder: 'calendary', title: 'Nome skill Alexa', description: 'Trovare un nome non ambiguo.' });
    assert.equal(again.structuredContent.folderCreated, false); // same folder, case insensitive
    const folders = call('list_note_folders').structuredContent.folders;
    assert.equal(folders.length, 1);
    assert.equal(folders[0].open, 2);
    const stored = notes.listNotes()[0];
    assert.equal(stored.source, 'claude');
    assert.ok(stored.title);
  });

  test('list, update, done', () => {
    call('create_note_folder', { name: 'Moveo', description: 'App di allenamento' });
    call('add_note', { folder: 'Moveo', title: 'Pausa attiva', description: 'Suggerire esercizi diversi.' });
    const list = call('list_notes', { folder: 'Calendary' }).structuredContent.notes;
    assert.equal(list.length, 2);
    const id = list[0].id;
    call('update_note', { id, done: true, folder: 'Moveo' });
    assert.equal(call('list_notes', { folder: 'Calendary' }).structuredContent.notes.length, 1);
    assert.equal(call('list_notes', { folder: 'Moveo', include_done: true }).structuredContent.notes.length, 2);
    const bad = call('list_notes', { folder: 'Inesistente' });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /non trovata/);
    assert.equal(call('add_note', { folder: 'X', title: ' ', description: 'y' }).isError, true);
  });

  test('deleting a folder keeps its notes', () => {
    const f = notes.findFolder('Moveo');
    notes.deleteFolder(f.id);
    assert.equal(notes.listNotes({ folderId: 'none' }).length, 2);
  });
});
