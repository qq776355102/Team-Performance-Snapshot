
import { createClient } from '@supabase/supabase-js';

/**
 * 环境变量读取逻辑说明：
 * 1. 在 Vercel 构建时，process.env 会被尝试注入。
 * 2. 如果您使用 Vite 等工具，通常需要 VITE_ 前缀，但在这里我们保持现状并添加备选检查。
 */
const getEnv = (key: string): string => {
  // 尝试从不同的全局变量中读取
  const val = (process.env as any)?.[key] || 
              (window as any)?._env_?.[key] || 
              (import.meta as any)?.env?.[`VITE_${key}`] || 
              '';
  return val;
};

const supabaseUrl = getEnv('SUPABASE_URL');
const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');

// 诊断日志 - 部署后可以在浏览器控制台看到
console.log('%c[Supabase Check]', 'color: #3b82f6; font-weight: bold', {
  urlSet: !!supabaseUrl,
  keySet: !!supabaseAnonKey,
  urlStart: supabaseUrl ? supabaseUrl.substring(0, 12) + '...' : 'none'
});

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase Error] 环境变量未能在浏览器中识别。');
}

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder-if-missing.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);
