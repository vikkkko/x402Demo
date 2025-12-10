/**
 * Besu RPC 代理
 * 将 alloy 的 'input' 字段转换为 Besu 期望的 'data' 字段
 */

const http = require('http');
const https = require('https');

const BESU_URL = process.env.BESU_URL || 'http://35.188.26.169:8545';
const PROXY_PORT = process.env.PROXY_PORT || 8545;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      // 解析 JSON-RPC 请求
      let request = JSON.parse(body);

      // 处理单个请求或批量请求
      const requests = Array.isArray(request) ? request : [request];

      requests.forEach(r => {
        console.log('\n=== RPC 请求 ===');
        console.log('method:', r.method);

        // 如果是 eth_call 或 eth_estimateGas 并且有 input 字段，将其转换为 data 字段
        if ((r.method === 'eth_call' || r.method === 'eth_estimateGas') && r.params && r.params[0]) {
          const callObject = r.params[0];
          console.log('to:', callObject.to);
          console.log('from:', callObject.from);
          if (callObject.input && !callObject.data) {
            callObject.data = callObject.input;
            delete callObject.input;
            console.log('转换 input -> data');
          }
          console.log('data:', callObject.data);
        } else if (r.method === 'eth_sendRawTransaction') {
          console.log('raw tx:', r.params[0]);
        } else if (r.method === 'eth_getCode') {
          console.log('address:', r.params[0]);
          console.log('block:', r.params[1]);
        } else {
          console.log('params:', JSON.stringify(r.params, null, 2));
        }
        console.log('===================\n');
      });

      // 转发到 Besu
      const url = new URL(BESU_URL);
      const options = {
        hostname: url.hostname,
        port: url.port || 8545,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      };

      const transport = url.protocol === 'https:' ? https : http;
      const proxyReq = transport.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (e) => {
        console.error('Proxy error:', e);
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Bad Gateway', message: e.message }));
      });

      proxyReq.write(JSON.stringify(Array.isArray(request) ? requests : requests[0]));
      proxyReq.end();

    } catch (e) {
      console.error('Parse error:', e);
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad Request', message: e.message }));
    }
  });
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`Besu proxy running on 0.0.0.0:${PROXY_PORT}`);
  console.log(`Forwarding to: ${BESU_URL}`);
  console.log('Converting input -> data for eth_call requests');
});
