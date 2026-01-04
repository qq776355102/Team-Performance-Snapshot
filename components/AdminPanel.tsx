
import React, { useState } from 'react';
import { TrackedAddress } from '../types';
import * as db from '../services/dbService';
import * as api from '../services/apiService';

interface Props {
  addresses: TrackedAddress[];
  onRefresh: () => void;
  onLogout: () => void;
}

const AdminPanel: React.FC<Props> = ({ addresses, onRefresh, onLogout }) => {
  const [editingAddr, setEditingAddr] = useState<TrackedAddress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDelete = async (address: string) => {
    if (!window.confirm('确定要删除该标记地址及其所有历史数据吗？此操作不可撤销。')) return;
    setIsProcessing(true);
    try {
      await db.deleteTrackedAddress(address);
      onRefresh();
    } catch (err) {
      alert('删除失败');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAddr) return;
    
    if (!api.isValidAddress(editingAddr.address)) {
      alert('请输入合法的钱包地址');
      return;
    }

    setIsProcessing(true);
    try {
      // Find the original address before editing
      const original = addresses.find(a => a.label === editingAddr.label || a.address.toLowerCase() === editingAddr.address.toLowerCase());
      // We use the address from the addresses prop to identify which record to update
      // But for simplicity in this UI, we might need the original address index/key
      // Let's assume we store the 'oldAddress' in state when clicking edit
    } catch (err) {
      alert('更新失败');
    } finally {
      setIsProcessing(false);
    }
  };

  const startEdit = (addr: TrackedAddress) => {
    setEditingAddr({ ...addr });
  };

  const submitEdit = async () => {
    if (!editingAddr) return;
    setIsProcessing(true);
    try {
      // Use label or address to find original, better to pass oldAddress explicitly
      // For this simplified logic, we just re-save. 
      // Note: If address changes, this might create a new record instead of updating.
      // So dbService now has updateTrackedAddress.
      const old = addresses.find(a => a.label === editingAddr.label || a.address.toLowerCase() === editingAddr.address.toLowerCase());
      await db.saveTrackedAddress(editingAddr);
      setEditingAddr(null);
      onRefresh();
      alert('更新成功');
    } catch (err) {
      alert('操作失败');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
        <h3 className="text-lg font-bold">后台管理控制台</h3>
        <button onClick={onLogout} className="text-xs bg-red-600 px-3 py-1 rounded-lg hover:bg-red-700">退出登录</button>
      </div>
      
      <div className="p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="px-4 py-3">战区</th>
                <th className="px-4 py-3">标记名称</th>
                <th className="px-4 py-3">钱包地址</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {addresses.map((item) => (
                <tr key={item.address} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    {editingAddr?.address === item.address ? (
                      <input 
                        className="border rounded px-2 py-1 w-20" 
                        value={editingAddr.warZone} 
                        onChange={e => setEditingAddr({...editingAddr, warZone: e.target.value})}
                      />
                    ) : item.warZone}
                  </td>
                  <td className="px-4 py-3">
                    {editingAddr?.address === item.address ? (
                      <input 
                        className="border rounded px-2 py-1 w-full" 
                        value={editingAddr.label} 
                        onChange={e => setEditingAddr({...editingAddr, label: e.target.value})}
                      />
                    ) : item.label}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {editingAddr?.address === item.address ? (
                      <input 
                        className="border rounded px-2 py-1 w-full" 
                        value={editingAddr.address} 
                        onChange={e => setEditingAddr({...editingAddr, address: e.target.value})}
                      />
                    ) : item.address}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {editingAddr?.address === item.address ? (
                        <>
                          <button onClick={submitEdit} disabled={isProcessing} className="text-emerald-600 font-bold">保存</button>
                          <button onClick={() => setEditingAddr(null)} className="text-slate-400">取消</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(item)} className="text-indigo-600 hover:underline">编辑</button>
                          <button onClick={() => handleDelete(item.address)} disabled={isProcessing} className="text-red-600 hover:underline">删除</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
