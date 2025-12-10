require('dotenv').config();
const express = require('express');
const cors = require('cors');
const X402Middleware = require('./middleware/x402');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 初始化 x402 中间件
const x402Config = {
  facilitatorUrl: process.env.FACILITATOR_URL || 'https://facilitator.payai.network',
  network: process.env.NETWORK || 'base-sepolia',
  payToAddress: process.env.PAY_TO_ADDRESS,
  pricePerRequest: parseFloat(process.env.PRICE_PER_REQUEST || '0.01'),
  currency: 'USDC',
  currencyAddress: process.env.CURRENCY_ADDRESS || '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // Base Sepolia USDC
  scheme: 'exact'
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
    message: 'x402 Merchant Server',
    version: '1.0.0',
    endpoints: {
      '/': 'This endpoint (no payment required)',
      '/api/free': 'Free endpoint example',
      '/api/protected': 'Protected endpoint (requires payment)',
      '/api/chat': 'Protected chat endpoint (requires payment)',
      '/health': 'Health check'
    },
    configuration: {
      network: x402Config.network,
      pricePerRequest: x402Config.pricePerRequest,
      currency: x402Config.currency,
      payToAddress: x402Config.payToAddress,
      facilitator: x402Config.facilitatorUrl
    }
  });
});

// 健康检查 - 不需要付费
app.get('/health', async (req, res) => {
  try {
    // 检查 facilitator 是否可用
    const supported = await x402.getSupportedSchemes();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      facilitator: {
        url: x402Config.facilitatorUrl,
        available: true,
        supported: supported
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// 免费端点示例
app.get('/api/free', (req, res) => {
  res.json({
    message: 'This is a free endpoint',
    data: 'You can access this without payment'
  });
});

// 受保护的端点 - 需要付费
app.get('/api/protected', x402.middleware(), (req, res) => {
  res.json({
    message: 'Success! You have access to this protected content.',
    data: {
      secret: 'This is valuable protected data',
      timestamp: new Date().toISOString(),
      payment: {
        from: req.x402Payment?.payment?.from,
        amount: x402Config.pricePerRequest,
        currency: x402Config.currency
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
      aiResponse: `This is a paid AI response. You asked: "${message || 'Hello'}". Thank you for your payment of ${x402Config.pricePerRequest} ${x402Config.currency}!`,
      timestamp: new Date().toISOString(),
      payment: {
        from: req.x402Payment?.payment?.from,
        amount: x402Config.pricePerRequest,
        currency: x402Config.currency
      }
    }
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log('\n🚀 x402 Merchant Server Started\n');
  console.log(`📡 Server listening on: http://localhost:${PORT}`);
  console.log(`🌐 Network: ${x402Config.network}`);
  console.log(`💰 Price per request: ${x402Config.pricePerRequest} ${x402Config.currency}`);
  console.log(`📮 Payment address: ${x402Config.payToAddress}`);
  console.log(`🔧 Facilitator: ${x402Config.facilitatorUrl}`);
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
