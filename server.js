const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

if (!API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  // Serve index.html at root
  if ((parsedUrl.pathname === '/' || parsedUrl.pathname === '') && req.method === 'GET') {
    try {
      const indexPath = path.join(__dirname, 'index.html');
      const html = fs.readFileSync(indexPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('Error loading index.html');
    }
    return;
  }

  if (parsedUrl.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '5.28.1' }));
    return;
  }

  if (parsedUrl.pathname === '/api/complete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const input = JSON.parse(body);
        const { prompt, model, maxTokens } = input;

        const anthropicReq = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-version': '2023-06-01',
            'Authorization': `Bearer ${API_KEY}`
          }
        }, (anthropicRes) => {
          let data = '';
          anthropicRes.on('data', chunk => data += chunk);
          anthropicRes.on('end', () => {
            if (anthropicRes.statusCode >= 400) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: data }));
            } else {
              try {
                const parsed = JSON.parse(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  success: true,
                  completion: parsed.content[0].text,
                  usage: parsed.usage
                }));
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Parse error' }));
              }
            }
          });
        });

        const payload = JSON.stringify({
          model: model || 'claude-3-5-sonnet-20241022',
          max_tokens: maxTokens || 512,
          messages: [{ role: 'user', content: prompt }]
        });

        anthropicReq.write(payload);
        anthropicReq.end();

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Jarvis API proxy listening on port ${PORT}`);
});
