require('dotenv').config();
const X402Client = require('./client');

async function test() {
  console.log('🧪 测试 v2 多 Token 支付流程\n');

  const client = new X402Client({
    serverUrl: 'http://localhost:3000',
    privateKey: process.env.CLIENT_PRIVATE_KEY
  });

  try {
    console.log('📤 请求受保护资源...\n');
    await client.requestProtectedResource('/api/protected', 'GET');
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
  }
}

test();
