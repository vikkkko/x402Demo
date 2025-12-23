require('dotenv').config();
const express = require('express');
const cors = require('cors');
const X402Middleware = require('./middleware/x402');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 构建支持的 Token 列表
const supportedTokens = [];

// DailyLedger Token
if (process.env.DAILYLEDGER_ADDRESS) {
  supportedTokens.push({
    contractType: 'DailyLedger',
    address: process.env.DAILYLEDGER_ADDRESS,
    chainId: parseInt(process.env.DAILYLEDGER_CHAIN_ID || '1337'),
    domainName: 'DailyLedger',
    domainVersion: '1',
    explorerUrl: process.env.DAILYLEDGER_EXPLORER_URL || 'http://220.154.132.194:3001',
    description: 'Pay with DailyLedger (Private Chain)',
    amount: null // 使用默认价格
  });
}

// USDC Token
if (process.env.USDC_ADDRESS) {
  supportedTokens.push({
    contractType: 'USDC',
    address: process.env.USDC_ADDRESS,
    chainId: parseInt(process.env.USDC_CHAIN_ID || '84532'),
    domainName: 'USD Coin',
    domainVersion: '2',
    explorerUrl: process.env.USDC_EXPLORER_URL || 'https://sepolia.basescan.org',
    description: 'Pay with USDC (Base Sepolia)',
    amount: null // 使用默认价格
  });
}

// 验证至少配置了一个 Token
if (supportedTokens.length === 0) {
  console.error('❌ Error: No tokens configured. Please set at least one token ADDRESS in .env');
  process.exit(1);
}

// 初始化 x402 中间件 (v2 多 Token 版本)
const x402Config = {
  facilitatorUrl: process.env.FACILITATOR_URL || 'http://localhost:8080',
  payToAddress: process.env.PAY_TO_ADDRESS,
  pricePerRequest: parseFloat(process.env.PRICE_PER_REQUEST || '0.01'),
  supportedTokens: supportedTokens
};

// 验证必需的配置
if (!x402Config.payToAddress) {
  console.error('❌ Error: PAY_TO_ADDRESS is not configured in .env');
  process.exit(1);
}

const x402 = new X402Middleware(x402Config);

// 根路由 - 不需要付费
app.get('/', (req, res) => {
  res.json({
    message: 'x402 Merchant Server (v2)',
    version: '2.0.0',
    endpoints: {
      '/': 'This endpoint (no payment required)',
      '/health': 'Health check',
      '/api/protected': 'Protected endpoint (requires payment)',
      '/api/chat': 'Protected chat endpoint (requires payment)'
    },
    paymentOptions: supportedTokens.map(t => ({
      token: t.contractType,
      network: `eip155:${t.chainId}`,
      description: t.description
    }))
  });
});

// 健康检查 - 不需要付费
app.get('/health', async (req, res) => {
  try {
    const supported = await x402.getSupportedSchemes();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      facilitator: {
        url: x402Config.facilitatorUrl,
        available: true,
        supported: supported
      },
      tokens: supportedTokens.length
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// 受保护的端点 - 需要付费
app.get('/api/protected', x402.middleware(), (req, res) => {
  res.json({
    message: 'Success! You have access to this protected content.',
    data: {
      secret: 'This is valuable protected data',
      timestamp: new Date().toISOString(),
      payment: {
        amount: x402Config.pricePerRequest
      }
    }
  });
});

// 受保护的聊天端点 - 模拟 AI 对话
app.post('/api/chat', x402.middleware(), (req, res) => {
  const { message } = req.body;

  res.json({
    message: 'Chat response',
    data: {
      userMessage: message || 'Hello',
      aiResponse: `This is a paid AI response. You asked: "${message || 'Hello'}". Thank you for your payment!`,
      timestamp: new Date().toISOString()
    }
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log('\n🚀 x402 Merchant Server Started (v2)\n');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`💰 Price: ${x402Config.pricePerRequest} per request`);
  console.log(`📮 Pay to: ${x402Config.payToAddress}`);
  console.log(`🔧 Facilitator: ${x402Config.facilitatorUrl}`);
  console.log(`\n💳 Supported Payment Options (${supportedTokens.length}):`);
  supportedTokens.forEach((token, i) => {
    console.log(`   ${i + 1}. ${token.description}`);
    console.log(`      Network: eip155:${token.chainId}`);
    console.log(`      Contract: ${token.address}`);
  });
  console.log('\n✅ Ready to accept payments!\n');
  console.log('Try accessing:');
  console.log(`  - http://localhost:${PORT}/ (free)`);
  console.log(`  - http://localhost:${PORT}/health (free)`);
  console.log(`  - http://localhost:${PORT}/api/protected (requires payment)`);
  console.log(`  - http://localhost:${PORT}/api/chat (requires payment)\n`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});
