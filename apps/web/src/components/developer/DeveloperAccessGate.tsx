import { ShieldAlert } from 'lucide-react';

export function DeveloperAccessGate() {
  return (
    <main className="flex-grow pt-24 pb-12 px-6 max-w-5xl mx-auto w-full">
      <div className="flex gap-3 rounded-lg border border-red-500/30 bg-red-950/20 p-6 text-red-200">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <div>
          <h1 className="text-lg font-bold">无权访问配置与监控</h1>
          <p className="mt-1 text-sm text-red-200/80">该区域仅允许管理员和开发者访问；团队项目素材请从账号菜单进入团队管理。</p>
        </div>
      </div>
    </main>
  );
}
