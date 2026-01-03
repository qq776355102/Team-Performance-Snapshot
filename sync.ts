
import { createClient } from '@supabase/supabase-js';

// 从环境变量读取配置
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const PRECISION = 9;
const MAX_RETRIES = 5; // 最大重试次数
const BASE_RETRY_DELAY = 10000; // 基础重试间隔 10 秒
const BATCH_SIZE = 3; // 每批次处理 3 个地址

// --- 工具函数 ---

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 带有递增重试逻辑的 fetch 包装器
 * 报错后等待时间随重试次数增加
 */
async function fetchWithRetry(url: string, options: any, description: string): Promise<any> {
  let lastError: any;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (e: any) {
      lastError = e;
      const currentDelay = (i + 1) * BASE_RETRY_DELAY;
      console.warn(`⚠️ [${description}] 尝试第 ${i + 1} 次失败: ${e.message}。等待 ${currentDelay / 1000}s 后重试...`);
      if (i < MAX_RETRIES - 1) {
        await delay(currentDelay);
      }
    }
  }
  console.error(`❌ [${description}] 在尝试 ${MAX_RETRIES} 次后全部失败。`);
  return null;
}

// --- 基础 API 函数 ---

const formatStaking = (raw: string | number): number => {
  try {
    const val = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.floor(Number(raw)));
    return Number(val) / Math.pow(10, PRECISION);
  } catch (e) {
    return 0;
  }
};

const fetchLevel = async (address: string) => {
  const data = await fetchWithRetry(
    `https://apiv2.ocros.io/api/v1/community/${address}`,
    {
      method: "POST",
      headers: { "accept": "*/*", "Referer": "https://origindefi.io/" }
    },
    `fetchLevel ${address}`
  );
  return data?.level || 'Unknown';
};

const fetchInviteData = async (address: string) => {
  const data = await fetchWithRetry(
    `https://apiv2.ocros.io/api/v1/communities/getInviteData?address=${address}&level=undefined`,
    { headers: { "accept": "application/json", "Referer": "https://origindefi.io/" } },
    `fetchInviteData ${address}`
  );
  return data || { directReferralQuantity: 0, teamNumber: '0' };
};

const fetchStakingStatus = async (address: string) => {
  const data = await fetchWithRetry(
    `https://api.ocros.io/v1/api/comm/queryStakingStatus?member=${address}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "Referer": "https://origindefi.io/" }
    },
    `fetchStakingStatus ${address}`
  );
  return data || { teamStaking: '0', role: 'Unknown' };
};

const fetchReferrer = async (address: string): Promise<string | null> => {
  const addressParam = address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const bodyData = "0x08ae4b0c" + addressParam;
  
  const resData = await fetchWithRetry(
    "https://greatest-powerful-feather.matic.quiknode.pro/d05012eaa00b33a3aa3e8e7981b2d658f4281815/",
    {
      method: "POST",
      headers: { "content-type": "application/json", "Referer": "https://origindefi.io/" },
      body: JSON.stringify({
        "method": "eth_call",
        "params": [{ "to": "0x6757165973042541ebdec47b73283397b5afd90e", "data": bodyData }, "latest"],
        "id": 44, "jsonrpc": "2.0"
      })
    },
    `fetchReferrer ${address}`
  );

  if (resData?.result && resData.result !== '0x') {
    const hex = resData.result.slice(2);
    if (hex.length < 128) return null;
    const referrer = '0x' + hex.slice(64, 128).slice(24);
    if (referrer === '0x' + '0'.repeat(40)) return null;
    return referrer.toLowerCase();
  }
  return null;
};

const fetchFullChain = async (address: string, cache: Map<string, string | null>) => {
  const chain: string[] = [];
  let current: string | null = address.toLowerCase();
  while (current && chain.length < 100) {
    let next = cache.has(current) ? cache.get(current)! : await fetchReferrer(current);
    cache.set(current, next);
    if (!next) break;
    chain.push(next);
    current = next;
    await delay(200); // 内部微延迟
  }
  return chain;
};

// --- 同步任务主逻辑 ---

async function runSync() {
  console.log('🚀 开始执行每日同步任务...');
  
  // 1. 获取所有待追踪地址
  const { data: dbAddresses, error: dbError } = await supabase.from('tracked_addresses').select('*');
  if (dbError || !dbAddresses) throw new Error('读取地址列表失败');
  
  console.log(`📊 共有 ${dbAddresses.length} 个地址待同步，将分批处理 (每批 ${BATCH_SIZE} 个) 以平衡效率与频率限制。`);

  const today = new Date().toISOString().split('T')[0];
  const referralCache = new Map<string, string | null>();
  const rawData: any[] = [];

  // 2. 分批抓取数据
  for (let i = 0; i < dbAddresses.length; i += BATCH_SIZE) {
    const batch = dbAddresses.slice(i, i + BATCH_SIZE);
    console.log(`📡 [批次处理] 正在同步第 ${i + 1} 到 ${Math.min(i + BATCH_SIZE, dbAddresses.length)} 个地址...`);

    const results = await Promise.all(batch.map(async (item) => {
      try {
        // 每个地址内部的数据抓取仍然保持一定的串行或极短延迟，防止瞬时并发极高
        const invite = await fetchInviteData(item.address);
        const stake = await fetchStakingStatus(item.address);
        const chain = await fetchFullChain(item.address, referralCache);
        const level = await fetchLevel(item.address);

        return {
          address: item.address.toLowerCase(),
          label: item.label,
          warZone: item.war_zone,
          level,
          directReferrals: invite.directReferralQuantity,
          teamNumber: parseInt(invite.teamNumber || '0'),
          teamStaking: formatStaking(stake.teamStaking),
          referrerChain: chain
        };
      } catch (err) {
        console.error(`❌ 处理地址 ${item.address} 时出现错误:`, err);
        return null;
      }
    }));

    // 过滤掉失败的地址并加入结果集
    rawData.push(...results.filter(r => r !== null));

    // 批次之间增加延迟
    if (i + BATCH_SIZE < dbAddresses.length) {
      console.log(`⏳ 批次完成，等待 5s 进入下一批...`);
      await delay(5000);
    }
  }

  // 3. 计算有效业绩 (核心扣除逻辑)
  console.log('🧮 正在计算业绩层级关系...');
  const finalMetrics = rawData.map(A => {
    const nearestChildren: string[] = [];
    const others = rawData.filter(X => X.address !== A.address);
    
    others.forEach(B => {
      const idx = B.referrerChain.indexOf(A.address);
      if (idx !== -1) {
        const pathBetween = B.referrerChain.slice(0, idx);
        const hasOtherMarkedInBetween = pathBetween.some(mid => 
          rawData.some(r => r.address === mid)
        );
        if (!hasOtherMarkedInBetween) {
          nearestChildren.push(B.address);
        }
      }
    });

    const childrenStakingSum = nearestChildren.reduce((acc, childAddr) => {
      const child = rawData.find(r => r.address === childAddr);
      return acc + (child ? child.teamStaking : 0);
    }, 0);

    return {
      address: A.address,
      date: today,
      metrics: {
        label: A.label,
        warZone: A.warZone,
        level: A.level,
        directReferrals: A.directReferrals,
        teamNumber: A.teamNumber,
        teamStaking: A.teamStaking,
        effectiveStaking: Math.max(0, A.teamStaking - childrenStakingSum),
        referrer: A.referrerChain[0] || null,
        nearestLabeledChildren: nearestChildren
      }
    };
  });

  // 4. 写入 Supabase
  console.log('💾 正在保存快照到数据库...');
  for (const item of finalMetrics) {
    const { error } = await supabase.from('snapshots').upsert({
      address: item.address,
      date: item.date,
      metrics: item.metrics
    }, { onConflict: 'address,date' });
    if (error) console.error(`保存失败 ${item.address}:`, error.message);
    await delay(100); 
  }

  // 5. 更新 tracked_addresses 中的等级
  console.log('🏷️ 更新地址等级信息...');
  for (const item of rawData) {
    await supabase.from('tracked_addresses').update({ level: item.level }).eq('address', item.address);
  }

  console.log('✅ 同步任务圆满完成！');
}

runSync().catch(err => {
  console.error('❌ 同步过程中出现致命错误:', err);
  (process as any).exit(1);
});
