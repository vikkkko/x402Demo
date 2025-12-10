const { ethers } = require('ethers');
require('dotenv').config();

const USDC_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
  'function balanceOf(address account) view returns (uint256)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)'
];

async function testDirectTransfer() {
  // 配置
  const rpcUrl = 'https://sepolia.base.org';
  const usdcAddress = '0xDE87AF9156a223404885002669D3bE239313Ae33';
  const merchantAddress = '0x0CBdDc750fB3a1A5CD38EA6d0786408f4251f880';

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(process.env.CLIENT_PRIVATE_KEY, provider);
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, provider);

  console.log('='.repeat(60));
  console.log('测试直接调用 USDC transferWithAuthorization');
  console.log('='.repeat(60));
  console.log('');

  console.log('客户端地址:', wallet.address);
  console.log('商家地址:', merchantAddress);
  console.log('');

  // 检查余额
  const balance = await usdc.balanceOf(wallet.address);
  console.log('USDC 余额:', ethers.formatUnits(balance, 6), 'USDC');

  // 检查合约 domain 参数
  const tokenName = await usdc.name();
  const tokenVersion = await usdc.version();
  const domainSeparator = await usdc.DOMAIN_SEPARATOR();
  console.log('');
  console.log('USDC 合约信息:');
  console.log('  name:', tokenName);
  console.log('  version:', tokenVersion);
  console.log('  DOMAIN_SEPARATOR:', domainSeparator);
  console.log('');

  if (balance < 10000n) {
    console.log('❌ USDC 余额不足 0.01 USDC');
    return;
  }

  // 创建签名
  const value = '10000'; // 0.01 USDC
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 3600;
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);

  console.log('签名参数:');
  console.log('  from:', wallet.address);
  console.log('  to:', merchantAddress);
  console.log('  value:', value);
  console.log('  validAfter:', validAfter);
  console.log('  validBefore:', validBefore);
  console.log('  nonce:', nonce);
  console.log('');

  // 检查 nonce 是否已使用
  const nonceUsed = await usdc.authorizationState(wallet.address, nonce);
  console.log('Nonce 已使用:', nonceUsed);
  console.log('');

  // EIP-712 domain
  const domain = {
    name: tokenName,  // 使用从合约读取的实际 name
    version: tokenVersion,  // 使用从合约读取的实际 version
    chainId: 84532,
    verifyingContract: usdcAddress
  };

  // EIP-712 types
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  };

  // Message
  const message = {
    from: wallet.address,
    to: merchantAddress,
    value: value,
    validAfter: validAfter,
    validBefore: validBefore,
    nonce: nonce
  };

  console.log('签名中...');
  const signature = await wallet.signTypedData(domain, types, message);
  const sig = ethers.Signature.from(signature);

  console.log('✅ 签名完成');
  console.log('  v:', sig.v);
  console.log('  r:', sig.r);
  console.log('  s:', sig.s);
  console.log('');

  // 准备调用参数
  const v = sig.v; // ethers v6 Signature.from() 已经返回 27/28
  const r = sig.r;
  const s = sig.s;

  console.log('调用 transferWithAuthorization...');
  console.log('  v (adjusted):', v);
  console.log('  r:', r);
  console.log('  s:', s);
  console.log('');

  try {
    // 估算 gas
    const gasEstimate = await usdc.transferWithAuthorization.estimateGas(
      wallet.address,
      merchantAddress,
      value,
      validAfter,
      validBefore,
      nonce,
      v,
      r,
      s,
      { from: wallet.address }
    );

    console.log('✅ Gas 估算成功:', gasEstimate.toString());
    console.log('');

    // 发送交易
    const tx = await usdc.connect(wallet).transferWithAuthorization(
      wallet.address,
      merchantAddress,
      value,
      validAfter,
      validBefore,
      nonce,
      v,
      r,
      s
    );

    console.log('✅ 交易已发送:', tx.hash);
    console.log('等待确认...');

    const receipt = await tx.wait();
    console.log('');
    console.log('✅ 交易已确认!');
    console.log('区块:', receipt.blockNumber);
    console.log('Gas 使用:', receipt.gasUsed.toString());
    console.log('');
    console.log('查看交易: https://sepolia.basescan.org/tx/' + tx.hash);

  } catch (error) {
    console.log('');
    console.log('❌ 交易失败');
    console.log('错误:', error.message);

    if (error.reason) {
      console.log('原因:', error.reason);
    }

    if (error.data) {
      console.log('数据:', error.data);
    }

    // 尝试解析错误
    if (error.message.includes('invalid signature')) {
      console.log('');
      console.log('可能的原因:');
      console.log('1. EIP-712 domain 参数不正确');
      console.log('2. 签名的消息结构不匹配');
      console.log('3. v 值不正确（应该是 27 或 28）');
    }
  }
}

testDirectTransfer().catch(console.error);
