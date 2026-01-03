
import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrackedAddress, 
  AddressMetrics, 
  Snapshot 
} from './types';
import * as db from './services/dbService';
import * as api from './services/apiService';
import { isSupabaseConfigured } from './services/supabaseClient';
import AddressTable from './components/AddressTable';

const App: React.FC = () => {
  const [addresses, setAddresses] = useState<TrackedAddress[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPathLoading, setIsPathLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newWarZone, setNewWarZone] = useState('1');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showHistoryModal, setShowHistoryModal] = useState<AddressMetrics | null>(null);
  const [showPathModal, setShowPathModal] = useState<{address: string, chain: string[]} | null>(null);
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);

  const loadData = async () => {
    if (!isSupabaseConfigured) {
      setInitError("【环境变量缺失】未检测到 Supabase 配置。请在 Vercel 中检查 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。");
      return;
    }

    setIsLoading(true);
    try {
      const [addrs, history] = await Promise.all([
        db.getTrackedAddresses(),
        db.getSnapshots()
      ]);
      setAddresses(addrs);
      setSnapshots(history);
      if (history.length > 0) {
        setLastSyncDate(history[0].date);
      }
      setInitError(null);
    } catch (err: any) {
      console.error(err);
      setInitError(`连接异常: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const runSync = async () => {
    if (addresses.length === 0) {
      alert("请先添加需要追踪的地址");
      return;
    }
    
    setIsLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const referralCache = new Map<string, string | null>();
      
      const rawData = await Promise.all(addresses.map(async (item) => {
        const [invite, stake, chain, level] = await Promise.all([
          api.fetchInviteData(item.address),
          api.fetchStakingStatus(item.address),
          api.fetchFullChain(item.address, referralCache),
          api.fetchLevel(item.address)
        ]);
        
        return {
          ...item,
          level, // 同步获取等级
          directReferrals: invite.directReferralQuantity,
          teamNumber: parseInt(invite.teamNumber || '0'),
          teamStaking: api.formatStaking(stake.teamStaking),
          referrerChain: chain,
          referrer: chain[0] || null
        };
      }));

      // 自动同步地址等级到 tracked_addresses 表
      await Promise.all(rawData.map(r => db.saveTrackedAddress({
        address: r.address,
        label: r.label,
        warZone: r.warZone,
        level: r.level
      })));

      const metrics: AddressMetrics[] = rawData.map(A => {
        const nearestChildren: string[] = [];
        const otherLabeledAddresses = rawData.filter(X => X.address.toLowerCase() !== A.address.toLowerCase());
        
        otherLabeledAddresses.forEach(B => {
          if (B.referrerChain.some(anc => anc.toLowerCase() === A.address.toLowerCase())) {
            const idx = B.referrerChain.findIndex(anc => anc.toLowerCase() === A.address.toLowerCase());
            const pathBetween = B.referrerChain.slice(0, idx);
            const isNearest = !pathBetween.some(mid => 
              otherLabeledAddresses.some(label => label.address.toLowerCase() === mid.toLowerCase())
            );
            if (isNearest) {
              nearestChildren.push(B.address);
            }
          }
        });

        const childrenStaking = nearestChildren.reduce((acc, childAddr) => {
          const childData = rawData.find(r => r.address.toLowerCase() === childAddr.toLowerCase());
          return acc + (childData ? childData.teamStaking : 0);
        }, 0);

        return {
          address: A.address,
          label: A.label,
          warZone: A.warZone,
          level: A.level,
          directReferrals: A.directReferrals,
          teamNumber: A.teamNumber,
          teamStaking: A.teamStaking,
          effectiveStaking: Math.max(0, A.teamStaking - childrenStaking),
          referrer: A.referrer,
          nearestLabeledChildren: nearestChildren
        };
      });

      await Promise.all(metrics.map(m => {
        const { address, label, warZone, level, ...rest } = m;
        return db.saveSnapshotRecord(m.address, today, {
          ...rest,
          label,
          warZone,
          level
        });
      }));

      await db.cleanupOldSnapshots();
      await loadData();
      alert("同步完成：等级、人数、质押已更新");
    } catch (err) {
      console.error(err);
      alert("同步失败，请检查网络或 Supabase 配置。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAddress = async () => {
    if (!newAddr || !newLabel) return;
    const addrFormatted = newAddr.trim().toLowerCase();
    if (addresses.some(a => a.address.toLowerCase() === addrFormatted)) {
      alert("地址已存在");
      return;
    }
    setIsLoading(true);
    try {
      // 添加时顺便获取一次初始等级
      const level = await api.fetchLevel(addrFormatted);
      const item: TrackedAddress = { 
        address: addrFormatted, 
        label: newLabel.trim(), 
        warZone: newWarZone,
        level: level 
      };
      await db.saveTrackedAddress(item);
      await loadData();
      setNewAddr('');
      setNewLabel('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAddress = async (addr: string) => {
    if (!confirm('【警告】确定要移除此地址及其历史 7 天快照数据吗？此操作无法撤销。')) return;
    setIsLoading(true);
    try {
      await db.deleteTrackedAddress(addr);
      await loadData();
    } finally {
      setIsLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const latest = snapshots.find(s => s.date === todayStr) || snapshots[0];
    if (!latest) return [];
    
    return latest.data.filter(item => {
      const search = searchTerm.toLowerCase();
      return item.label.toLowerCase().includes(search) || 
             item.address.toLowerCase().includes(search) || 
             item.warZone?.toLowerCase().includes(search) ||
             item.level?.toLowerCase().includes(search);
    });
  }, [snapshots, searchTerm]);

  const fetchPath = async (address: string) => {
    if (isPathLoading) return;
    setIsPathLoading(true);
    try {
      const chain = await api.fetchFullChain(address);
      setShowPathModal({ address, chain });
    } catch (err) {
      alert("路径查询失败");
    } finally {
      setIsPathLoading(false);
    }
  };

  const getAddressLabel = (addr: string) => {
    const found = addresses.find(a => a.address.toLowerCase() === addr.toLowerCase());
    return found ? found.label : null;
  };

  const isTodaySynced = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return snapshots.some(s => s.date === todayStr);
  }, [snapshots]);

  return (
    <div className="min-h-screen pb-12 bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">TR</div>
            <h1 className="text-lg font-bold text-slate-900">团队业绩快照</h1>
          </div>
          <div className="flex items-center space-x-4">
            {isSupabaseConfigured && (
              <span className={`text-xs font-medium px-2 py-1 rounded ${isTodaySynced ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                {isTodaySynced ? '今日已同步' : '今日未同步'}
              </span>
            )}
            <button
              onClick={runSync}
              disabled={isLoading || !isSupabaseConfigured}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm ${
                isLoading || !isSupabaseConfigured
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
              }`}
            >
              {isLoading ? '正在处理...' : '同步今日数据'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {initError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {initError}
          </div>
        )}

        <section className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-wider flex items-center space-x-2">
              <span className="w-1.5 h-4 bg-indigo-600 rounded-full"></span>
              <span>地址标记管理</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <div className="md:col-span-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">战区</label>
                <div className="relative">
                  <select 
                    value={['1','2','3','4','5','6'].includes(newWarZone) ? newWarZone : 'custom'} 
                    onChange={(e) => setNewWarZone(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 appearance-none"
                  >
                    {[1,2,3,4,5,6].map(v => <option key={v} value={v.toString()}>{v} 战区</option>)}
                    <option value="custom">自定义名称</option>
                  </select>
                  {!['1','2','3','4','5','6'].includes(newWarZone) && (
                    <input 
                      type="text" 
                      value={newWarZone}
                      placeholder="输入战区名"
                      onChange={(e) => setNewWarZone(e.target.value)}
                      className="absolute inset-0 w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                </div>
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-medium text-slate-500 mb-1">标注名称</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="例如: 团队长A"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">钱包地址</label>
                <input
                  type="text"
                  value={newAddr}
                  onChange={(e) => setNewAddr(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleAddAddress}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-slate-800 text-white text-sm rounded-lg font-medium hover:bg-slate-900 disabled:opacity-50 h-[38px]"
                >
                  添加标记
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full max-w-lg">
              <input
                type="text"
                placeholder="快速检索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full pl-4 pr-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 sm:text-sm"
              />
            </div>
            <button
              onClick={() => {
                const csv = "战区,等级,标注,地址\n" + addresses.map(a => `${a.warZone},${a.level},${a.label},${a.address}`).join("\n");
                const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `标记地址导出_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
              }}
              className="text-xs text-indigo-600 font-bold bg-indigo-50 px-4 py-2 rounded-lg"
            >
              导出标注列表 (CSV)
            </button>
          </div>

          <AddressTable 
            data={filteredData} 
            onRemove={handleRemoveAddress} 
            onShowHistory={(m) => setShowHistoryModal(m)}
            onShowPath={fetchPath}
            getAddressLabel={getAddressLabel}
          />
        </section>
      </main>

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{showHistoryModal.label} - 历史波动</h3>
                <p className="text-xs text-slate-400 font-mono">{showHistoryModal.address}</p>
              </div>
              <button onClick={() => setShowHistoryModal(null)} className="text-slate-400 text-2xl px-2">&times;</button>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-slate-500 border-b border-slate-100">
                    <tr>
                      <th className="pb-3 pr-4">日期</th>
                      <th className="pb-3 pr-4">等级</th>
                      <th className="pb-3 pr-4">团队质押</th>
                      <th className="pb-3 pr-4 text-indigo-600">有效业绩</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {snapshots.map(s => {
                      const m = s.data.find(d => d.address.toLowerCase() === showHistoryModal.address.toLowerCase());
                      if (!m) return null;
                      return (
                        <tr key={s.date} className="hover:bg-slate-50">
                          <td className="py-3 pr-4 font-medium">{s.date}</td>
                          <td className="py-3 pr-4 text-indigo-600 font-bold">{m.level || '-'}</td>
                          <td className="py-3 pr-4">{m.teamStaking.toLocaleString()}</td>
                          <td className="py-3 pr-4 font-bold text-indigo-600">{m.effectiveStaking.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Path Modal */}
      {showPathModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-bold">邀请路径溯源</h3>
              <button onClick={() => setShowPathModal(null)} className="text-slate-400 text-2xl px-2">&times;</button>
            </div>
            <div className="p-8 overflow-y-auto">
              <div className="relative space-y-6">
                <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-slate-100"></div>
                {/* Start node */}
                <div className="relative flex items-start space-x-4">
                  <div className="w-3.5 h-3.5 bg-indigo-600 rounded-full mt-1.5 shrink-0 z-10 ring-4 ring-indigo-50"></div>
                  <div>
                    <div className="text-[10px] text-indigo-600 font-bold">查询地址</div>
                    <div className="font-bold">{getAddressLabel(showPathModal.address) || '当前地址'}</div>
                    <div className="text-xs text-slate-400 font-mono">{showPathModal.address}</div>
                  </div>
                </div>
                {showPathModal.chain.map((addr, idx) => {
                  const label = getAddressLabel(addr);
                  return (
                    <div key={idx} className="relative flex items-start space-x-4">
                      <div className={`w-3.5 h-3.5 ${label ? 'bg-emerald-500 ring-4 ring-emerald-50' : 'bg-slate-200'} rounded-full mt-1.5 shrink-0 z-10`}></div>
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-400">上级推荐人 (L{idx + 1})</div>
                        <div className={`font-semibold ${label ? 'text-emerald-700' : ''}`}>
                          {label ? `[已标记] ${label}` : '未标记地址'}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">{addr}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status Tip */}
      {isLoading && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl z-50 flex items-center space-x-3 animate-pulse">
          <span className="text-xs font-bold tracking-wide">区块链同步中...</span>
        </div>
      )}
    </div>
  );
};

export default App;
