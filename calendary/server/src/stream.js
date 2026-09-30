// Server-Sent Events: every open client (PC, kiosk tablet) gets a "changed" ping
// after any mutation, so the tablet updates as soon as something is edited from the PC.

const clients = new Set();

export function streamHandler(req, reply) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const client = { res };
  clients.add(client);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.raw.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

export function broadcast(scope) {
  const payload = `event: changed\ndata: ${JSON.stringify({ scope, at: Date.now() })}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}
