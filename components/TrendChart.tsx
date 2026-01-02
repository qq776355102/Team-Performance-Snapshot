
import React from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { Snapshot, DailySummary } from '../types';

interface Props {
  snapshots: Snapshot[];
}

const TrendChart: React.FC<Props> = ({ snapshots }) => {
  const chartData = snapshots
    .map(s => {
      const totalStaking = s.data.reduce((acc, d) => acc + d.teamStaking, 0);
      const totalEffective = s.data.reduce((acc, d) => acc + d.effectiveStaking, 0);
      return {
        date: s.date.slice(5), // Short date MM-DD
        '总质押': totalStaking,
        '有效质押': totalEffective
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8 h-80">
      <h3 className="text-lg font-semibold mb-4 text-slate-800">业绩趋势 (最近7天)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
          <YAxis stroke="#64748b" fontSize={12} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val} />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          />
          <Legend />
          <Line 
            type="monotone" 
            dataKey="总质押" 
            stroke="#94a3b8" 
            strokeWidth={2} 
            dot={{ r: 4 }} 
            activeDot={{ r: 6 }}
          />
          <Line 
            type="monotone" 
            dataKey="有效质押" 
            stroke="#2563eb" 
            strokeWidth={2} 
            dot={{ r: 4 }} 
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendChart;
