const { ethers } = require('ethers');
require('dotenv').config();

const LEDGER_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, string memo, uint8 v, bytes32 r, bytes32 s) external',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)'
];

async function testDirectTransfer() {
  // 配置私链 DailyLedger
  const rpcUrl = 'http://220.154.132.194:8545';
  const ledgerAddress = '0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e';
  const merchantAddress = process.env.PAY_TO_ADDRESS || '0x0CBdDc750fB3a1A5CD38EA6d0786408f4251f880';

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(process.env.CLIENT_PRIVATE_KEY, provider);
  const ledger = new ethers.Contract(ledgerAddress, LEDGER_ABI, provider);

  console.log('='.repeat(60));
  console.log('测试直接调用 DailyLedger transferWithAuthorization (带 memo)');
  console.log('='.repeat(60));
  console.log('');

  console.log('客户端地址:', wallet.address);
  console.log('商家地址:', merchantAddress);
  console.log('合约地址:', ledgerAddress);
  console.log('');

  // 创建签名
  const value = '10000'; // 0.01 单位
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 3600;
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
  const memo = 'direct-test';

  console.log('签名参数:');
  console.log('  from:', wallet.address);
  console.log('  to:', merchantAddress);
  console.log('  value:', value);
  console.log('  memo:', memo);
  console.log('  validAfter:', validAfter);
  console.log('  validBefore:', validBefore);
  console.log('  nonce:', nonce);
  console.log('');

  // 检查 nonce 是否已使用
  const nonceUsed = await ledger.authorizationState(wallet.address, nonce);
  console.log('Nonce 已使用:', nonceUsed);
  console.log('');

  // EIP-712 domain
  const domain = {
    name: 'DailyLedger',
    version: '1',
    chainId: 1337,
    verifyingContract: ledgerAddress
  };

  // EIP-712 types
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'memo', type: 'string' }
    ]
  };

  // Message
  const message = {
    from: wallet.address,
    to: merchantAddress,
    value: value,
    validAfter: validAfter,
    validBefore: validBefore,
    nonce: nonce,
    memo: memo
  };

  console.log('签名中...');
  const signature = await wallet.signTypedData(domain, types, message);
  const sig = ethers.Signature.from(signature);

  console.log('✅ 签名完成');
  console.log('  v:', sig.v);
  console.log('  r:', sig.r);
  console.log('  s:', sig.s);
  console.log('');

  const v = sig.v;
  const r = sig.r;
  const s = sig.s;

  console.log('调用 transferWithAuthorization...');
  try {
    const gasEstimate = await ledger.transferWithAuthorization.estimateGas(
      wallet.address,
      merchantAddress,
      value,
      validAfter,
      validBefore,
      nonce,
      memo,
      v,
      r,
      s,
      { from: wallet.address }
    );

    console.log('✅ Gas 估算成功:', gasEstimate.toString());

    const tx = await ledger.connect(wallet).transferWithAuthorization(
      wallet.address,
      merchantAddress,
      value,
      validAfter,
      validBefore,
      nonce,
      memo,
      v,
      r,
      s
    );

    console.log('✅ 交易已发送:', tx.hash);
    console.log('等待确认...');

    const receipt = await tx.wait();
    console.log('✅ 交易已确认!');
    console.log('区块:', receipt.blockNumber);
    console.log('Gas 使用:', receipt.gasUsed.toString());
  } catch (error) {
    console.log('❌ 交易失败');
    console.log('错误:', error.message);

    if (error.reason) {
      console.log('原因:', error.reason);
    }

    if (error.data) {
      console.log('数据:', error.data);
    }

    if (error.message.includes('invalid signature')) {
      console.log('可能的原因:');
      console.log('1. EIP-712 domain 参数不正确');
      console.log('2. 签名的消息结构不匹配 (缺少 memo)');
      console.log('3. v 值不正确（应该是 27 或 28）');
    }
  }
}

testDirectTransfer().catch(console.error);
