
import { createClient } from '@supabase/supabase-js';

// Vercel 在构建时会注入 process.env
const supabaseUrl = (process.env as any).SUPABASE_URL || (window as any)._env_?.SUPABASE_URL || '';
const supabaseAnonKey = (process.env as any).SUPABASE_ANON_KEY || (window as any)._env_?.SUPABASE_ANON_KEY || '';

// 诊断日志
console.log('[Supabase Check] URL Configured:', !!supabaseUrl);
console.log('[Supabase Check] Key Configured:', !!supabaseAnonKey);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase Error] 环境变量缺失！请在 Vercel Settings -> Environment Variables 中配置 SUPABASE_URL 和 SUPABASE_ANON_KEY。');
}

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder-if-missing.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);
