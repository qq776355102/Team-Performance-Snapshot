
import React from 'react';
import { DailySummary } from '../types';

interface Props {
  summary: DailySummary;
}

const SummaryCards: React.FC<Props> = ({ summary }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <p className="text-sm font-medium text-slate-500 mb-1">总团队质押 (LGNS)</p>
        <h3 className="text-2xl font-bold text-slate-900">{summary.totalTeamStaking.toLocaleString(undefined, { maximumFractionDigits: 2 })}</h3>
      </div>
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <p className="text-sm font-medium text-slate-500 mb-1">总有效质押 (LGNS)</p>
        <h3 className="text-2xl font-bold text-blue-600">{summary.totalEffectiveStaking.toLocaleString(undefined, { maximumFractionDigits: 2 })}</h3>
      </div>
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <p className="text-sm font-medium text-slate-500 mb-1">总团队人数</p>
        <h3 className="text-2xl font-bold text-slate-900">{summary.totalMembers.toLocaleString()}</h3>
      </div>
    </div>
  );
};

export default SummaryCards;
