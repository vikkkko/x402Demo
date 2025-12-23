require('dotenv').config();

/**
 * 检查 middleware 配置是否正确
 */

const contractType = process.env.CONTRACT_TYPE || 'DailyLedger';

console.log('='.repeat(70));
console.log('Merchant Server 配置检查');
console.log('='.repeat(70));
console.log();

console.log('环境变量:');
console.log(`  CONTRACT_TYPE: ${contractType}`);
console.log(`  CURRENCY_ADDRESS: ${process.env.CURRENCY_ADDRESS}`);
console.log(`  DAILYLEDGER_ADDRESS: ${process.env.DAILYLEDGER_ADDRESS}`);
console.log(`  USDC_ADDRESS: ${process.env.USDC_ADDRESS}`);
console.log();

// 模拟 middleware 构造
const X402Middleware = require('./middleware/x402');

const config = {
  facilitatorUrl: process.env.FACILITATOR_URL || 'http://localhost:8080',
  network: process.env.NETWORK || 'base-sepolia',
  payToAddress: process.env.PAY_TO_ADDRESS,
  pricePerRequest: parseFloat(process.env.PRICE_PER_REQUEST || '0.01'),
  currency: 'USDC',
  currencyAddress: process.env.CURRENCY_ADDRESS,
  contractType: contractType,
  scheme: 'exact',
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  explorerUrl: process.env.EXPLORER_URL
};

const middleware = new X402Middleware(config);

console.log('Middleware 配置:');
console.log(`  contractType: ${middleware.contractType}`);
console.log(`  domainName: ${middleware.domainName}`);
console.log(`  domainVersion: ${middleware.domainVersion}`);
console.log(`  currencyAddress: ${middleware.currencyAddress}`);
console.log(`  chainId: ${middleware.chainId}`);
console.log(`  explorerUrl: ${middleware.explorerUrl}`);
console.log();

// 模拟生成 contractMetadata 字段（发送给客户端）
const contractMetadata = {
  domainName: middleware.domainName,
  domainVersion: middleware.domainVersion,
  chainId: middleware.chainId,
  verifyingContract: middleware.currencyAddress,
  contractType: middleware.contractType,
  explorerUrl: middleware.explorerUrl
};

console.log('发送给客户端的 contractMetadata 字段:');
console.log(JSON.stringify(contractMetadata, null, 2));
console.log();

// 模拟生成 extra 字段（发送给协调器）
const extra = {
  name: middleware.domainName,
  version: middleware.domainVersion,
  contractType: middleware.contractType,
  allowNegativeBalance: middleware.contractType === 'DailyLedger' ? true : false
};

console.log('发送给协调器的 extra 字段:');
console.log(JSON.stringify(extra, null, 2));
console.log();

// 验证
console.log('='.repeat(70));
console.log('验证结果:');
console.log('='.repeat(70));
console.log();

if (contractType === 'DailyLedger') {
  console.log('✅ 合约类型: DailyLedger');
  console.log(`✅ Domain Name: ${middleware.domainName === 'DailyLedger' ? middleware.domainName : '❌ 错误'}`);
  console.log(`✅ Domain Version: ${middleware.domainVersion === '1' ? middleware.domainVersion : '❌ 错误'}`);
  console.log(`✅ allowNegativeBalance: ${extra.allowNegativeBalance === true ? 'true' : '❌ false（错误！）'}`);

  if (extra.allowNegativeBalance !== true) {
    console.log();
    console.log('❌ 错误：allowNegativeBalance 应该是 true！');
    console.log('   这会导致协调器尝试检查余额，从而失败。');
    process.exit(1);
  }
} else if (contractType === 'USDC') {
  console.log('✅ 合约类型: USDC');
  console.log(`✅ Domain Name: ${middleware.domainName === 'USD Coin' ? middleware.domainName : '❌ 错误'}`);
  console.log(`✅ Domain Version: ${middleware.domainVersion === '2' ? middleware.domainVersion : '❌ 错误'}`);
  console.log(`✅ allowNegativeBalance: ${extra.allowNegativeBalance === false ? 'false' : '❌ true（错误！）'}`);
}

console.log();
console.log('='.repeat(70));
console.log('✅ 配置检查通过！可以启动测试。');
console.log('='.repeat(70));
