
import { createClient } from '@supabase/supabase-js';

// 重要：必须使用完整的 process.env.变量名，以便打包工具在构建阶段进行静态替换
// 如果重新部署后依然为 false，请尝试在 Vercel 中将变量名修改为 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY
const supabaseUrl = (process.env as any).SUPABASE_URL || '';
const supabaseAnonKey = (process.env as any).SUPABASE_ANON_KEY || '';

// 诊断日志：部署后可在控制台确认变量是否被成功注入
console.log('%c[Supabase 注入检查]', 'color: #6366f1; font-weight: bold', {
  urlLoaded: !!supabaseUrl,
  keyLoaded: !!supabaseAnonKey,
  info: supabaseUrl ? '环境变量已成功读取' : '未检测到环境变量，请确保已 Redeploy 并检查变量名'
});

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);
