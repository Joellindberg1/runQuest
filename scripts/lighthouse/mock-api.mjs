// Falskt API för Lighthouse-körningen (RUN-259): svarar bara på GET /api/public/stats, med de tre tal landningens sifferrad läser.
// Frontend-bygget pekar på http://localhost:3001/api när VITE_API_URL saknas, så den här servern lyssnar på just den porten i läget "mock".
// Allt annat ger 404. Ingen databas, inget nätverk utanför loopback.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const MOCK_STATS = { runners: 6, challenges: 42, km: 1234 };

const CORS = { 'Access-Control-Allow-Origin': '*' };

export function createMockApi() {
  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && path === '/api/public/stats') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: MOCK_STATS }));
      return;
    }
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  });
}

// Startas som egen process av run.sh: node mock-api.mjs <port>
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 3001);
  createMockApi().listen(port, '127.0.0.1', () => console.log(`mock-api lyssnar på 127.0.0.1:${port}`));
}
