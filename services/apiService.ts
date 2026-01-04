
import { InviteData, StakingData } from '../types';

const PRECISION = 9;

/**
 * 验证以太坊风格地址合法性
 */
export const isValidAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

export const formatStaking = (raw: string | number): number => {
  try {
    const val = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.floor(Number(raw)));
    return Number(val) / Math.pow(10, PRECISION);
  } catch (e) {
    return 0;
  }
};

// 获取地址等级 Level
export const fetchLevel = async (address: string): Promise<string> => {
  try {
    const res = await fetch(`https://apiv2.ocros.io/api/v1/community/${address}`, {
      method: "POST",
      headers: {
        "accept": "*/*",
        "Referer": "https://origindefi.io/",
      }
    });
    if (!res.ok) return 'Unknown';
    const text = await res.text();
    if (!text) return 'Unknown';
    const data = JSON.parse(text);
    return data.level || 'Unknown';
  } catch (error) {
    console.error("Fetch level error:", error);
    return 'Error';
  }
};

export const fetchInviteData = async (address: string): Promise<InviteData> => {
  try {
    const url = `https://apiv2.ocros.io/api/v1/communities/getInviteData?address=${address}&level=undefined`;
    const res = await fetch(url, {
      headers: {
        "accept": "application/json",
        "Referer": "https://origindefi.io/",
      }
    });
    if (!res.ok) return { directReferralQuantity: 0, teamNumber: '0' };
    const text = await res.text();
    if (!text) return { directReferralQuantity: 0, teamNumber: '0' };
    return JSON.parse(text);
  } catch (e) {
    return { directReferralQuantity: 0, teamNumber: '0' };
  }
};

export const fetchStakingStatus = async (address: string): Promise<StakingData> => {
  try {
    const res = await fetch(`https://api.ocros.io/v1/api/comm/queryStakingStatus?member=${address}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Referer": "https://origindefi.io/",
      }
    });
    if (!res.ok) return { teamStaking: '0', role: 'Unknown' };
    const text = await res.text();
    if (!text) return { teamStaking: '0', role: 'Unknown' };
    return JSON.parse(text);
  } catch (e) {
    return { teamStaking: '0', role: 'Unknown' };
  }
};

export const fetchReferrer = async (address: string): Promise<string | null> => {
  const addressParam = address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const data = "0x08ae4b0c" + addressParam;

  try {
    const res = await fetch("https://greatest-powerful-feather.matic.quiknode.pro/d05012eaa00b33a3aa3e8e7981b2d658f4281815/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Referer": "https://origindefi.io/",
      },
      body: JSON.stringify({
        "method": "eth_call",
        "params": [
          {
            "to": "0x6757165973042541ebdec47b73283397b5afd90e",
            "data": data
          },
          "latest"
        ],
        "id": 44,
        "jsonrpc": "2.0"
      })
    });
    
    const resData = await res.json();
    const result = resData.result;
    if (result && result !== '0x') {
      const hex = result.startsWith("0x") ? result.slice(2) : result;
      if (hex.length < 128) return null;
      const referrerHex = hex.slice(64, 128);
      const referrer = '0x' + referrerHex.slice(24);
      const zeroAddr = '0x' + '0'.repeat(40);
      if (referrer.toLowerCase() === zeroAddr) return null;
      return '0x' + referrer.slice(2).toLowerCase();
    }
  } catch (error) {
    console.error("Referrer fetch error:", error);
  }
  return null;
};

export const fetchFullChain = async (
  address: string, 
  cache: Map<string, string | null> = new Map()
): Promise<string[]> => {
  const chain: string[] = [];
  let current: string | null = address.toLowerCase();
  const maxDepth = 100;

  while (current && chain.length < maxDepth) {
    let next: string | null;
    if (cache.has(current)) {
      next = cache.get(current)!;
    } else {
      next = await fetchReferrer(current);
      cache.set(current, next);
    }
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
};

/**
 * 向上追溯，直到遇到已标记地址或到达0地址
 */
export const fetchChainUntilLabeled = async (
  address: string,
  isLabeled: (addr: string) => boolean,
  cache: Map<string, string | null> = new Map()
): Promise<string[]> => {
  const chain: string[] = [];
  let current: string | null = address.toLowerCase();
  const maxDepth = 100;

  while (current && chain.length < maxDepth) {
    let next: string | null;
    if (cache.has(current)) {
      next = cache.get(current)!;
    } else {
      next = await fetchReferrer(current);
      cache.set(current, next);
    }
    
    if (!next) break;
    chain.push(next);
    
    // 如果这个推荐人已经是被标记的，停止进一步查询
    if (isLabeled(next)) break;
    
    current = next;
  }
  return chain;
};
