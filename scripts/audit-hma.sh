#!/system/bin/sh
# Open-Box & HMA Automated Security Auditor for OnePlus / Android
# 负责自动审计新安装的 App，实现长效防封、永不失效

HMA_CONF="/data/user/0/com.tsng.hidemyapplist/files/config.json"
NODE_BIN="/data/adb/modules/openbox_android/node/bin/node"

echo "=========================================================="
echo "   HMA 隐藏应用列表 · 智能持久化审计与自动维护工具   "
echo "=========================================================="

if [ ! -f "$HMA_CONF" ]; then
    echo "❌ 错误: 未找到 HMA 配置文件 ($HMA_CONF)，请确认 HMA 已安装并初始化。"
    exit 1
fi

cat << 'EOF' > /data/local/tmp/hma_audit.mjs
import fs from 'node:fs';

const hmaFile = '/data/user/0/com.tsng.hidemyapplist/files/config.json';
const conf = JSON.parse(fs.readFileSync(hmaFile, 'utf8'));

const content = fs.readFileSync('/data/system/packages.list', 'utf8');
const allInstalled = content.split('\n').filter(Boolean).map(l => l.split(/\s+/)[0]);

// 1. 自动审计是否有新装的 Root / 玩机 / 修改器工具遗漏了黑名单
const blacklistPatterns = [
  'root', 'magisk', 'kernelsu', 'sukisu', 'apatch', 'termux', 'connectbot',
  'luckytool', 'xposed', 'lsposed', 'edxposed', 'shizuku', 'v2ray', 'clash',
  'stash', 'follow', 'detector', 'hook', 'hack', 'patch', 'mod'
];

let addedToBlacklist = 0;
const blacklist = new Set(conf.templates['root_blacklist_pro']?.appList || []);

for (const pkg of allInstalled) {
  if (pkg.startsWith('com.android.') || pkg.startsWith('android.') || pkg.startsWith('com.google.')) continue;
  const lower = pkg.toLowerCase();
  const isSuspicious = blacklistPatterns.some(pat => lower.includes(pat));
  if (isSuspicious && !blacklist.has(pkg)) {
    blacklist.add(pkg);
    console.log(`  [自动收编黑名单] 发现新安装的敏感/玩机应用: ${pkg}`);
    addedToBlacklist++;
  }
}

if (addedToBlacklist > 0) {
  if (!conf.templates['root_blacklist_pro']) {
    conf.templates['root_blacklist_pro'] = { isWhitelist: false, appList: [] };
  }
  conf.templates['root_blacklist_pro'].appList = Array.from(blacklist);
  conf.templates['root隐藏app'].appList = Array.from(blacklist);
}

// 2. 自动审计是否有新安装的银行/金融/政企应用没有开启【白名单+激进过滤】
const financePatterns = [
  'bank', 'mbank', 'boc', 'icbc', 'ccb', 'abc', 'psbc', 'spdb', 'cmb',
  'pay', 'unionpay', 'wallet', 'tax', '12123', 'hsa', 'binance', 'crypto'
];

let addedToScope = 0;
conf.scope = conf.scope || {};

for (const pkg of allInstalled) {
  if (pkg.startsWith('com.android.') || pkg.startsWith('android.') || pkg.startsWith('com.google.')) continue;
  const lower = pkg.toLowerCase();
  const isFinance = financePatterns.some(pat => lower.includes(pat));
  if (isFinance && !conf.scope[pkg]) {
    conf.scope[pkg] = {
      aggressiveFilter: true,
      useWhitelist: true,
      excludeSystemApps: true,
      applyTemplates: ['finance_whitelist'],
      extraAppList: []
    };
    console.log(`  [自动建立白名单防线] 发现新安装的金融/政企应用: ${pkg} (已分配白名单+激进过滤)`);
    addedToScope++;
  }
}

fs.writeFileSync(hmaFile, JSON.stringify(conf, null, 2), 'utf8');

// 3. 自动将 HMA 保护范围同步注入 LSPosed 数据库 (避免出现 HMA 勾选了但 LSPosed 没注入的致命暗坑)
import { DatabaseSync } from 'node:sqlite';
const lspDbPath = '/data/adb/lspd/config/modules_config.db';
let lspSynced = 0;
if (fs.existsSync(lspDbPath)) {
  try {
    const lspDb = new DatabaseSync(lspDbPath);
    const stmt = lspDb.prepare("INSERT OR IGNORE INTO scope (module_pkg_name, app_pkg_name, user_id) VALUES (?, ?, ?)");
    for (const app of Object.keys(conf.scope || {})) {
      if (app === 'system') continue;
      const res = stmt.run('com.tsng.hidemyapplist', app, 0);
      if (res.changes > 0) lspSynced++;
    }
  } catch (err) {
    console.warn('LSPosed scope sync error:', err.message);
  }
}

console.log("\n【审计总结】");
console.log(`  • 自动补全黑名单工具: ${addedToBlacklist} 款`);
console.log(`  • 自动建立白名单保护: ${addedToScope} 款`);
console.log(`  • 自动同步 LSPosed 作用域: ${lspSynced} 款`);
console.log(`  • 当前受白名单极致保护的应用总数: ${Object.values(conf.scope).filter(s => s.useWhitelist).length} 款`);
console.log(`  • 当前受黑名单保护的常规应用总数: ${Object.values(conf.scope).filter(s => !s.useWhitelist).length} 款`);
EOF

"$NODE_BIN" /data/local/tmp/hma_audit.mjs
rm -f /data/local/tmp/hma_audit.mjs

HMA_OWNER=$(stat -c '%u:%g' "/data/user/0/com.tsng.hidemyapplist" 2>/dev/null || stat -c '%u:%g' "$HMA_CONF" 2>/dev/null)
[ -n "$HMA_OWNER" ] && chown "$HMA_OWNER" "$HMA_CONF"
chmod 600 "$HMA_CONF"

echo "=========================================================="
echo "✔ HMA 审计完成！所有防御策略已同步固化并持久化生效。"
echo "=========================================================="
