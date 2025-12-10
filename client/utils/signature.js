const { ethers } = require('ethers');

/**
 * EIP-712 签名工具
 * 用于创建 transferWithAuthorization 签名
 */
class SignatureUtils {
  /**
   * 创建 EIP-712 类型化数据签名
   * @param {Object} params - 签名参数
   * @returns {Object} - 包含签名的完整支付数据
   */
  static async createTransferWithAuthorizationSignature(params) {
    const {
      wallet,
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
      domainName,
      domainVersion,
      chainId,
      verifyingContract
    } = params;

    // 定义 EIP-712 域
    const domain = {
      name: domainName,  // 应该是 "USDC"
      version: domainVersion,  // 应该是 "2"
      chainId: chainId,
      verifyingContract: verifyingContract
    };

    // 定义类型
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

    // 定义消息
    const message = {
      from: from,
      to: to,
      value: value,
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce
    };

    // 签名
    const signature = await wallet.signTypedData(domain, types, message);

    // 拆分签名
    const sig = ethers.Signature.from(signature);
    console.log('signature:', signature);
    console.log('sig.v:', sig.v);
    console.log('sig.r:', sig.r);
    console.log('sig.s:', sig.s);
    return {
      from: from,
      to: to,
      value: value,
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce,
      v: sig.v,
      r: sig.r,
      s: sig.s
    };
  }

  //ffe30b883937d316d60ad6cfc4bb76f54d8b3d4e394bf4eccf7a54bc175e681b
  //0cc32733a7f6cf8404f4373fc0cc0c1665a64c81295944074d363a2393e461f4
  //1b

  /**
   * 生成随机 nonce (基于时间戳的 bytes32)
   */
  static generateNonce() {
    const timestamp = Math.floor(Date.now() / 1000);
    return ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
  }

  /**
   * 获取网络配置
   */
  static getNetworkConfig(network) {
    const configs = {
      'base-sepolia': {
        // Besu 私链配置 (支持 EIP-3009)
        chainId: 1337,
        rpcUrl: 'http://35.188.26.169:8545',
        usdcAddress: '0xDE87AF9156a223404885002669D3bE239313Ae33',
        domainName: 'YZF Token',
        domainVersion: '1',
        explorerUrl: 'http://35.188.26.169:8545'  // Besu 私链没有区块浏览器
      },
      'base': {
        chainId: 8453,
        rpcUrl: 'https://mainnet.base.org',
        usdcAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        domainName: 'USD Coin',
        domainVersion: '2',
        explorerUrl: 'https://basescan.org'
      },
      'polygon-amoy': {
        chainId: 80002,
        rpcUrl: 'https://rpc-amoy.polygon.technology',
        usdcAddress: '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582',
        domainName: 'USD Coin',
        domainVersion: '2',
        explorerUrl: 'https://amoy.polygonscan.com'
      },
      'polygon': {
        chainId: 137,
        rpcUrl: 'https://polygon-rpc.com',
        usdcAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        domainName: 'USD Coin',
        domainVersion: '2',
        explorerUrl: 'https://polygonscan.com'
      }
    };

    const config = configs[network];
    if (!config) {
      throw new Error(`Unsupported network: ${network}`);
    }

    return config;
  }
}

module.exports = SignatureUtils;
