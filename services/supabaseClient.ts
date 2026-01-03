
import { createClient } from '@supabase/supabase-js';

/**
 * 环境变量读取逻辑 (适配 Vite + Vercel)
 * 1. 优先读取 import.meta.env (Vite 标准)
 * 2. 备选读取 process.env (Webpack/CRA 标准)
 */
const getEnv = (name: string): string => {
  const env = (import.meta as any).env;
  const proc = (process as any).env;
  
  return env?.[`VITE_${name}`] || 
         env?.[name] || 
         proc?.[`VITE_${name}`] || 
         proc?.[name] || 
         '';
};

const supabaseUrl = getEnv('SUPABASE_URL');
const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');

// 诊断日志：帮助在 Vercel 部署后的控制台排查
console.log('%c[Supabase 注入检查]', 'color: #6366f1; font-weight: bold', {
  urlFound: !!supabaseUrl,
  keyFound: !!supabaseAnonKey,
  method: (import.meta as any).env ? 'Vite/ESM' : 'CommonJS/Process',
  tip: !supabaseUrl ? '若为 false，请检查 Vercel 变量名是否已改为 VITE_ 开头并 Redeploy' : '注入成功'
});

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);
