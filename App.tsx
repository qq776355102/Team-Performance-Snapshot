
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
      setInitError("【环境变量缺失】项目已运行，但未检测到 Supabase 配置。请前往 Vercel 项目设置中的 Environment Variables 添加 SUPABASE_URL 和 SUPABASE_ANON_KEY，然后点击 Redeploy。");
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
      const msg = err.message || '';
      if (msg.includes('relation') || msg.includes('does not exist')) {
        setInitError("【数据库表缺失】已连接到 Supabase，但未找到数据表。请在 Supabase SQL Editor 中运行初始化的 SQL 脚本以创建 tracked_addresses 和 snapshots 表。");
      } else {
        setInitError(`【数据库连接异常】: ${msg || '网络连接失败或 Anon Key 无效'}`);
      }
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
        const [invite, stake, chain] = await Promise.all([
          api.fetchInviteData(item.address),
          api.fetchStakingStatus(item.address),
          api.fetchFullChain(item.address, referralCache)
        ]);
        
        return {
          ...item,
          directReferrals: invite.directReferralQuantity,
          teamNumber: parseInt(invite.teamNumber || '0'),
          teamStaking: api.formatStaking(stake.teamStaking),
          referrerChain: chain,
          referrer: chain[0] || null
        };
      }));

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
          directReferrals: A.directReferrals,
          teamNumber: A.teamNumber,
          teamStaking: A.teamStaking,
          effectiveStaking: Math.max(0, A.teamStaking - childrenStaking),
          referrer: A.referrer,
          nearestLabeledChildren: nearestChildren
        };
      });

      await Promise.all(metrics.map(m => {
        const { address, label, warZone, ...rest } = m;
        return db.saveSnapshotRecord(m.address, today, {
          ...rest,
          label,
          warZone
        });
      }));

      await db.cleanupOldSnapshots();
      await loadData();
      alert("今日数据同步完成");
    } catch (err) {
      console.error(err);
      alert("同步失败，请确保数据库 RLS 策略允许写入，或检查表结构是否正确。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAddress = async () => {
    if (!newAddr || !newLabel) return;
    const addrFormatted = newAddr.trim().toLowerCase();
    if (addresses.some(a => a.address.toLowerCase() === addrFormatted)) {
      alert("该地址已存在");
      return;
    }
    const item: TrackedAddress = { address: addrFormatted, label: newLabel.trim(), warZone: newWarZone };
    setIsLoading(true);
    try {
      await db.saveTrackedAddress(item);
      await loadData();
      setNewAddr('');
      setNewLabel('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAddress = async (addr: string) => {
    if (!confirm('确定移除此地址及其快照数据吗？')) return;
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
      const matchLabel = item.label.toLowerCase().includes(searchTerm.toLowerCase());
      const matchAddr = item.address.toLowerCase().includes(searchTerm.toLowerCase());
      const matchWarZone = item.warZone?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchLabel || matchAddr || matchWarZone;
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
              {isLoading ? '处理中...' : '同步今日数据'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {initError && (
          <div className="mb-6 p-5 bg-white border-l-4 border-red-500 rounded-r-xl shadow-md flex items-start space-x-4 text-slate-800">
            <div className="bg-red-100 p-2 rounded-full">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-bold text-base text-red-700">配置或连接异常</p>
              <p className="text-sm mt-1 leading-relaxed text-slate-600">{initError}</p>
              <div className="mt-3 flex space-x-4">
                <button onClick={loadData} className="text-xs font-bold text-indigo-600 hover:indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">立即重试</button>
                <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-xs font-bold text-slate-500 hover:text-slate-700 underline flex items-center">
                  检查 Supabase 状态
                </a>
              </div>
            </div>
          </div>
        )}

        <section className="space-y-6">
          {/* Add Address Form */}
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
                    value={['1','2','3','4','5'].includes(newWarZone) ? newWarZone : 'custom'} 
                    onChange={(e) => setNewWarZone(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 appearance-none"
                  >
                    {[1,2,3,4,5].map(v => <option key={v} value={v}>{v} 战区</option>)}
                    <option value="custom">自定义名称</option>
                  </select>
                  {!['1','2','3','4','5'].includes(newWarZone) && (
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">钱包地址</label>
                <input
                  type="text"
                  value={newAddr}
                  onChange={(e) => setNewAddr(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleAddAddress}
                  disabled={isLoading || !isSupabaseConfigured}
                  className="w-full px-4 py-2 bg-slate-800 text-white text-sm rounded-lg font-medium hover:bg-slate-900 transition-colors shadow-sm disabled:opacity-50 h-[38px]"
                >
                  添加标记
                </button>
              </div>
            </div>
          </div>

          {/* Search Header */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full max-w-lg">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="搜索名称、战区或地址..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 sm:text-sm shadow-sm"
              />
            </div>
            <button
              onClick={() => {
                const csv = "战区,标记,地址\n" + addresses.map(a => `${a.warZone},${a.label},${a.address}`).join("\n");
                const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `地址导出_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold bg-indigo-50 px-4 py-2 rounded-lg"
            >
              导出标注列表
            </button>
          </div>

          {/* Table */}
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
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{showHistoryModal.label} - 7日波动</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{showHistoryModal.address}</p>
              </div>
              <button onClick={() => setShowHistoryModal(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 text-2xl">&times;</button>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-slate-500 font-medium border-b border-slate-100">
                    <tr>
                      <th className="pb-3 pr-4">日期</th>
                      <th className="pb-3 pr-4">团队质押</th>
                      <th className="pb-3 pr-4 text-indigo-600">有效业绩</th>
                      <th className="pb-3 pr-4">直推</th>
                      <th className="pb-3">团队人数</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {snapshots.map(s => {
                      const m = s.data.find(d => d.address.toLowerCase() === showHistoryModal.address.toLowerCase());
                      if (!m) return null;
                      return (
                        <tr key={s.date} className="hover:bg-slate-50/50">
                          <td className="py-3 pr-4 font-medium text-slate-700">{s.date}</td>
                          <td className="py-3 pr-4">{m.teamStaking.toLocaleString()}</td>
                          <td className="py-3 pr-4 font-bold text-indigo-600">{m.effectiveStaking.toLocaleString()}</td>
                          <td className="py-3 pr-4 text-slate-600">{m.directReferrals}</td>
                          <td className="py-3 text-slate-600">{m.teamNumber}</td>
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
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900">邀请路径溯源 (向上查)</h3>
              <button onClick={() => setShowPathModal(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 text-2xl">&times;</button>
            </div>
            <div className="p-8 max-h-[70vh] overflow-y-auto">
              <div className="relative space-y-6">
                <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-slate-100"></div>
                <div className="relative flex items-start space-x-4">
                  <div className="w-3.5 h-3.5 bg-indigo-600 rounded-full mt-1.5 shrink-0 z-10 ring-4 ring-indigo-50"></div>
                  <div>
                    <div className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest">查询起始点</div>
                    <div className="font-bold text-slate-900">{getAddressLabel(showPathModal.address) || '当前地址'}</div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">{showPathModal.address}</div>
                  </div>
                </div>
                {showPathModal.chain.map((addr, idx) => {
                  const label = getAddressLabel(addr);
                  return (
                    <div key={`${addr}-${idx}`} className="relative flex items-start space-x-4">
                      <div className={`w-3.5 h-3.5 ${label ? 'bg-emerald-500 ring-4 ring-emerald-50' : 'bg-slate-200'} rounded-full mt-1.5 shrink-0 z-10`}></div>
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-400 font-medium">第 {idx + 1} 级上级推荐人</div>
                        <div className={`font-semibold ${label ? 'text-emerald-700' : 'text-slate-800'}`}>
                          {label ? `[已标记] ${label}` : '未标记地址'}
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{addr}</div>
                      </div>
                    </div>
                  );
                })}
                <div className="relative flex items-start space-x-4">
                  <div className="w-3.5 h-3.5 bg-slate-800 rounded-full mt-1.5 shrink-0 z-10"></div>
                  <div className="font-semibold text-slate-400 text-sm italic">推荐链条终止 (根地址/0地址)</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {(isLoading || isPathLoading) && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl z-50 flex items-center space-x-3 animate-pulse">
          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></div>
          <span className="text-xs font-bold tracking-wide uppercase">
            {isPathLoading ? '正在追溯区块链邀请路径...' : '正在同步 Supabase 数据...'}
          </span>
        </div>
      )}
    </div>
  );
};

export default App;
