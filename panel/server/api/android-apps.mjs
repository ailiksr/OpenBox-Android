import express from 'express'
import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import util from 'node:util'

const execPromise = util.promisify(exec)

// 覆盖常用国内、国际主流应用与系统工具的中文名称映射
const COMMON_APP_NAMES = {
  // 社交与通讯
  'com.tencent.mm': '微信',
  'com.tencent.mobileqq': 'QQ',
  'org.telegram.messenger': 'Telegram (电报)',
  'com.whatsapp': 'WhatsApp',
  'com.facebook.katana': 'Facebook (脸书)',
  'com.instagram.android': 'Instagram (照片墙)',
  'com.twitter.android': 'X (Twitter / 推特)',
  'com.discord': 'Discord',
  'com.sistalk.misio': '密思 (Misi)',

  // 购物与生活消费
  'com.taobao.taobao': '手机淘宝',
  'com.taobao.idlefish': '闲鱼 (二手交易)',
  'com.jingdong.app.mall': '京东',
  'com.xunmeng.pinduoduo': '拼多多',
  'com.sankuai.meituan': '美团',
  'me.ele': '饿了么',
  'com.wuba.zhuanzhuan': '转转 (二手平台)',
  'com.oppo.store': 'OPPO 商城',
  'com.xiaomi.shop': '小米商城',

  // 影音娱乐与流媒体
  'com.ss.android.ugc.aweme': '抖音',
  'com.smile.gifmaker': '快手',
  'com.kuaishou.nebula': '快手极速版',
  'com.bilibili.app.in': '哔哩哔哩 (B站)',
  'tv.danmaku.bili': '哔哩哔哩 (B站)',
  'com.netease.cloudmusic': '网易云音乐',
  'cn.toside.music.mobile': '落雪音乐 (LX Music)',
  'com.hupc.hmusic': 'HMusic 音乐播放器',
  'com.heytap.music': '欢太音乐 (系统自带)',
  'com.heytap.yoli': '欢太短视频',
  'com.heytap.themestore': '主题商店 (ColorOS)',
  'com.google.android.youtube': 'YouTube (油管)',
  'com.google.android.apps.youtube.music': 'YouTube Music',
  'com.playdigious.tmnt': '忍者神龟：施莱德的复仇',
  'nlch.game.imouto.mz': '妹魔 (手机游戏)',
  'com.valvesoftware.steamlink': 'Steam Link (游戏串流)',
  'com.nearme.gamecenter': '游戏中心 (ColorOS)',

  // 金融银行与政企民生 (强力推荐加入黑名单直连)
  'com.eg.android.AlipayGphone': '支付宝',
  'com.unionpay': '云闪付',
  'com.unionpay.tsmservice': '云闪付服务组件',
  'com.finshell.wallet': '欢太钱包 (ColorOS)',
  'com.chinamworld.main': '中国建设银行',
  'com.chinamworld.bocmbci': '建行手机银行 (客户端)',
  'cn.com.cmbc.newmbank': '中国民生银行',
  'com.cmbchina.ccd.pluto.cmbActivity': '掌上生活 (招商银行信用卡)',
  'com.icbc.mobilebanking': '中国工商银行',
  'com.android.bankabc': '中国农业银行',
  'com.boc.bocsoft': '中国银行',
  'cmb.pb': '招商银行',
  'com.psbc.cloud.mbank': '中国邮政储蓄银行',
  'com.spdb.fphone': '浦发银行',
  'com.pingan.paces.ccms': '平安口袋银行',
  'com.pingan.carowner': '平安好车主',
  'com.paypal.android.p2pmobile': 'PayPal 贝宝',
  'com.binance.dev': '币安 (Binance 交易所)',
  'cn.hsa.app': '国家医保服务平台',
  'cn.gov.tax.its': '个人所得税 (税务局官方)',
  'cn.gov.chinatax.its': '个人所得税 (税务局官方)',
  'com.tmri.app.main': '交管12123 (公安交警)',
  'com.MobileTicket': '铁路12306 (火车高铁票)',
  'com.chebada': '车来了 (实时公交与长途汽车)',
  'com.sdu.didi.psnger': '滴滴出行',
  'com.autonavi.minimap': '高德地图',
  'com.baidu.BaiduMap': '百度地图',
  'com.grabtaxi.passenger': 'Grab 出行 (海外版打车)',

  // 办公协同与生产力工具
  'com.alibaba.android.rimet': '钉钉',
  'com.ss.android.lark': '飞书',
  'com.tencent.wework': '企业微信',
  'cn.crec.wxwork': '中国中铁微工作',
  'com.tencent.androidqqmail': 'QQ 邮箱',
  'com.google.android.gm': 'Gmail 邮箱',
  'com.android.email': '系统电子邮件',
  'com.microsoft.office.excel': 'Microsoft Excel 表格',
  'com.microsoft.office.word': 'Microsoft Word 文档',
  'com.microsoft.office.officehubrow': 'Microsoft 365 (Office办公)',
  'com.microsoft.skydrive': 'Microsoft OneDrive 云盘',
  'com.microsoft.appmanager': '连接至 Windows (微软跨屏互联)',
  'com.fxkj.gantaskmanage': '甘特图任务管理',
  'com.haixue.saas': '嗨学课堂',
  'com.pdfeditor.pdfeditorandriod': 'PDF 编辑阅读器',
  'andes.oplus.documentsreader': '文档阅读器 (ColorOS)',
  'com.glodon.constructioncalculators': '广联达工程计算器',
  'app.skales.mobile': 'Skales 效率工具',

  // 云存储、下载与书签同步
  'com.baidu.drive.app': '百度网盘',
  'com.baidu.netdisk': '百度网盘',
  'com.xunlei.downloadprovider': '迅雷极速下载',
  'com.chinaunicom.bol.cloudapp': '联通云盘',
  'mega.privacy.android.app': 'MEGA 云端硬盘',
  'app.linkwarden': 'Linkwarden 书签同步',

  // 浏览器与内容社区
  'com.android.chrome': 'Google Chrome 浏览器',
  'com.quark.browser': '夸克浏览器',
  'mark.via.gp': 'Via 极简浏览器',
  'com.coolapk.market': '酷安 (玩机数码社区)',
  'com.zhihu.android': '知乎',
  'com.xingin.xhs': '小红书',
  'com.capyreader.app': 'Capy Reader (RSS 阅读器)',
  'com.blinko.app': 'Blinko 闪念便签',
  'com.beeswaxpat.lumara': 'Lumara 资讯阅读',
  'zed.rainxch.githubstore': 'GitHub 应用市场',
  'com.an1.store': 'AN1 应用市场',

  // 人工智能与大模型客户端
  'com.openai.chatgpt': 'ChatGPT (OpenAI 官方)',
  'com.deepseek.chat': 'DeepSeek 深度求索',
  'ai.x.grok': 'Grok (xAI 官方)',
  'com.aliyun.tongyi': '通义千问 (阿里大模型)',
  'com.google.android.apps.bard': 'Google Gemini (双子座)',
  'com.labteto.dshmobile': 'DSH Mobile (DeepSeek Harness)',

  // 极客玩机、Root 框架与网络工具
  'bin.mt.plus': 'MT 管理器',
  'moe.shizuku.privileged.api': 'Shizuku 权限调度器',
  'li.songe.gkd': 'GKD (李跳跳跳过开屏广告)',
  'com.tsng.hidemyapplist': '隐藏应用列表 (HMA)',
  'com.luckyzyx.luckytool': '大吉 LuckyTool (ColorOS系统级增强)',
  'com.daxiaamu.oplusmutools': '大侠阿木玩机工具箱',
  'com.daxiaamu.mijiapanel': '大侠阿木米家悬浮面板',
  'com.sukisu.ultra': 'SukiSU Ultra (Root 管理器)',
  'me.weishu.kernelsu': 'KernelSU 管理器',
  'com.termux': 'Termux 终端仿真器',
  'com.jhc.detach': 'Detach 模块设置器',
  'xyz.melodylsp.codec': 'Melody Codec 解码器',
  'com.unexpected.twitter': 'TwiFucker (推特去广告模块)',
  'com.blanke.diaomao163': '网易云音源插件 (Unblock163)',
  'com.adb.useroperation': '一键 ADB 控制台',
  'org.connectbot': 'ConnectBot (SSH 终端客户端)',
  'com.v2ray.ang.fdroid': 'v2rayNG 网络代理',
  'ws.stash.app': 'Stash 代理客户端',
  'com.follow.clash': 'Follow / Clash 客户端',
  'com.tailscale.ipn': 'Tailscale 虚拟局域网',
  'be.mygod.vpnhotspot': 'VPN 热点分流中继器',
  'com.ubnt.usurvey': 'WiFiman 网络专业测速仪',
  'icu.nullptr.applistdetector': '应用列表检测器 (Applist Detector)',
  'com.atharok.btremote': '蓝牙智能遥控器',
  'com.dangbei.remotecontroller': '当贝家电视遥控器',
  'com.x8bit.bitwarden': 'Bitwarden 密码保管箱',
  'com.bitwarden.authenticator': 'Bitwarden 双重身份验证器',

  // 智能硬件、车联与穿戴健康
  'com.xiaomi.smarthome': '米家 (小米智能家居)',
  'com.xiaomi.mico': '小爱音箱 App',
  'com.mi.health': '小米运动健康',
  'dji.go.v5': '大疆无人机飞行 (DJI Fly)',
  'com.geely.consumer': '吉利汽车 (Geely 手机互联)',
  'io.homeassistant.companion.android': 'Home Assistant 智能家居',
  'com.videogo': '萤石云视频 (海康威视监控监控)',
  'com.vivo.easyshare': 'vivo 互传',
  'com.omdigitalsolutions.oishare': '奥林巴斯相机助手 (OI.Share)',

  // 运营商与通信服务
  'com.sinovatech.unicom.ui': '中国联通手机营业厅',
  'com.ct.client': '中国电信手机营业厅',
  'com.ai.obc.cbn.app': '中国广电营业厅',
  'com.giffgaffmobile.controller': 'giffgaff (英国 SIM 卡管理)',
  'com.redteamobile.roaming': '红茶移动 (国际漫游流量)',

  // 气象、运动与多媒体引擎
  'com.windyty.android': 'Windy 全球专业天气雷达',
  'com.mendhak.gpslogger': 'GPS 轨迹记录仪',
  'com.trim.app': '剪映海外版 (Trim)',
  'com.trim.media': '剪映多媒体渲染服务',
  'com.weiken.audio': '微肯专业音频调试工具',
  'com.mallotec.reb.flapihub': 'FlapiHub 接口调试器',

  // Google 官方核心套件
  'com.google.android.apps.photos': 'Google 相册 (云相册)',
  'com.google.android.apps.docs': 'Google 云端硬盘 (Docs)',
  'com.google.android.apps.maps': 'Google 地图 (海外导航)',
  'com.google.android.apps.translate': 'Google 翻译',
  'com.google.android.apps.googlevoice': 'Google Voice 虚拟电话',
  'com.google.android.keep': 'Google Keep 记事本',
  'com.google.android.calendar': 'Google 日历',
  'com.google.android.contacts': 'Google 通讯录',
  'com.google.android.googlequicksearchbox': 'Google 搜索主程序',
  'com.google.android.inputmethod.latin': 'Gboard 谷歌键盘输入法',
  'com.google.android.apps.subscriptions.red': 'Google One 云空间会员',
  'com.google.android.vending': 'Google Play 商店',
  'com.google.android.gms': 'Google Play 服务 (GMS)',
  'com.google.android.gsf': 'Google 服务框架',
  'com.google.ar.core': 'Google Play AR 引擎',
  'com.google.android.safetycore': 'Google Android 安全组件',
  'com.google.android.verifier': 'Google Play 保护机制',

  // 一加 / OPPO / ColorOS 官方系统工具
  'com.oneplus.bbs': '一加手机社区',
  'com.oneplus.member': '一加会员俱乐部',
  'com.oneplus.brickmode': '一加禅定模式',
  'com.coloros.calendar': '日历 (系统自带)',
  'com.coloros.calculator': '计算器 (系统自带)',
  'com.coloros.alarmclock': '时钟与闹钟 (系统自带)',
  'com.coloros.weather2': '天气预报 (系统自带)',
  'com.coloros.compass2': '指南针 (系统自带)',
  'com.coloros.note': '便签与笔记 (系统自带)',
  'com.coloros.filemanager': '文件管理 (系统自带)',
  'com.coloros.soundrecorder': '录音机 (系统自带)',
  'com.coloros.translate': '系统全屏翻译',
  'com.coloros.shortcuts': '快捷指令 (系统自带)',
  'com.coloros.familyguard': '家人守护 (防沉迷与定位)',
  'com.oplus.riderMode': '骑行模式',
  'com.oplus.play': '游戏空间 (游戏加速)',
  'com.oplus.tips': '玩机技巧',
  'com.oplus.consumerIRApp': '红外遥控器',
  'com.oplus.melody': '铃声引擎',
}

// 智能提取包名核心特征（用于字典外生僻应用的中文展示）
const getCleanAppName = (pkg) => {
  if (COMMON_APP_NAMES[pkg]) return COMMON_APP_NAMES[pkg]
  const parts = pkg.split('.').filter((p) => !['com', 'cn', 'net', 'org', 'io', 'app', 'android', 'apk', 'mobile', 'client'].includes(p.toLowerCase()))
  if (parts.length > 0) {
    const last = parts[parts.length - 1]
    return last.charAt(0).toUpperCase() + last.slice(1)
  }
  return pkg
}

export const registerAndroidAppRoutes = (app, { paths, ctx }) => {
  app.use('/api/android', express.json({ limit: '1mb' }))
  const dataDir = paths.dataDir || path.join(paths.root, 'data')
  const bypassFile = path.join(dataDir, 'bypass_uids.txt')

  // 读取已保存的黑名单 UID 列表
  const readBypassUids = async () => {
    try {
      const content = await fs.readFile(bypassFile, 'utf8')
      return content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && /^\d+$/.test(line))
        .map(Number)
    } catch {
      return []
    }
  }

  // 获取手机已安装的全部 App 与 UID (直读 packages.list，极速且免 Binder 崩溃)
  app.get('/api/android/apps', async (_req, res) => {
    try {
      let content = ''
      try {
        content = await fs.readFile('/data/system/packages.list', 'utf8')
      } catch (err) {
        const p = await execPromise('pm list packages -U 2>/dev/null').catch(() => ({ stdout: '' }))
        content = p.stdout
      }

      const lines = content.split('\n').filter(Boolean)
      const apps = []

      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        let pkg = ''
        let uid = 0
        let isSystem = false

        if (parts[0].startsWith('package:')) {
          const m = line.match(/^package:([^\s]+)\s+uid:(\d+)/)
          if (m) {
            pkg = m[1]
            uid = Number(m[2])
            isSystem = uid < 10000
          }
        } else {
          pkg = parts[0]
          uid = Number(parts[1])
          isSystem = line.includes('@system') || uid < 10000
        }

        if (pkg && !isNaN(uid)) {
          const chineseName = COMMON_APP_NAMES[pkg]
          const labelName = chineseName || getCleanAppName(pkg)
          apps.push({
            packageName: pkg,
            appName: labelName,
            rawName: chineseName || '',
            uid,
            isSystem,
          })
        }
      }

      // 按第三方应用排在前面，且按拼音/名称字母排序
      apps.sort((a, b) => {
        if (a.isSystem !== b.isSystem) {
          return a.isSystem ? 1 : -1
        }
        return (a.rawName || a.appName).localeCompare(b.rawName || b.appName, 'zh-CN')
      })

      const bypassUids = await readBypassUids()

      res.json({
        ok: true,
        bypassUids,
        apps,
      })
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message })
    }
  })

  // 保存黑名单 UID 列表并立即重载防火墙
  app.post('/api/android/bypass', async (req, res) => {
    try {
      const { uids } = req.body || {}
      if (!Array.isArray(uids)) {
        return res.status(400).json({ ok: false, message: 'uids must be an array' })
      }

      const validUids = [...new Set(uids.filter((u) => typeof u === 'number' && Number.isInteger(u)))]
      const fileContent = `# Open-Box Android Bypass UIDs\n${validUids.join('\n')}\n`

      await fs.mkdir(dataDir, { recursive: true })
      await fs.writeFile(bypassFile, fileContent, 'utf8')

      // 立即重载 iptables 规则
      const iptablesScript = path.join(paths.root, 'scripts/iptables.sh')
      await execPromise(`sh ${iptablesScript} start 2>&1`)

      res.json({ ok: true, count: validUids.length })
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message })
    }
  })

  // 提供 100% 与 Open-Box 原生设计语言、字体与毛玻璃背景融为一体的应用分流页面
  app.get('/apps', async (_req, res) => {
    res.type('html')
    res.send(`<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>应用分流 - Open-Box</title>
  <!-- 引入 Open-Box 原生 DaisyUI 样式与 MiSans 字体 -->
  <link rel="stylesheet" crossorigin href="/assets/index-Cpc1zSc-.css">
  <link rel="stylesheet" crossorigin href="/assets/MiSans-VF-tRsyHePl.css">
  <style>
    :root {
      font-family: 'MiSans-VF', system-ui, -apple-system, sans-serif;
    }
    html, body {
      background: transparent !important;
      font-family: 'MiSans-VF', system-ui, -apple-system, sans-serif;
      -webkit-tap-highlight-color: transparent;
      padding-bottom: 2rem;
    }
  </style>
</head>
<body class="text-base-content min-h-full antialiased p-2 sm:p-3">

  <!-- 浮动提示组件 (DaisyUI Alert Toast) -->
  <div id="toast" class="toast toast-top toast-center z-50 transition-all duration-300 opacity-0 pointer-events-none -translate-y-2">
    <div class="alert alert-success text-xs py-2 px-4 shadow-lg border border-base-content/10 flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
      <span id="toastMsg">已保存并在底层生效</span>
    </div>
  </div>

  <div class="flex flex-col gap-2 max-w-4xl mx-auto">
    <!-- 顶部概览与控制卡片 (与 Open-Box 卡片完全一致的半透明毛玻璃质感) -->
    <div class="card bg-base-100/75 backdrop-blur-md border border-base-content/10 shadow-xs">
      <div class="card-body gap-3 p-3 sm:p-4">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-semibold text-base-content">应用分流 (黑名单)</h2>
              <span class="badge badge-outline badge-sm text-[11px] font-mono">Android</span>
            </div>
            <p class="text-base-content/60 text-xs mt-0.5">
              选中的应用将完全绕过代理内核，走本地网卡直连 (推荐网银、企业办公、国服低延迟游戏)
            </p>
          </div>
          <span id="statBadge" class="badge badge-sm badge-ghost text-xs shrink-0 font-mono">
            已排除: 0 款
          </span>
        </div>

        <!-- 搜索栏与过滤标签组 (DaisyUI 纯正风格) -->
        <div class="flex flex-col sm:flex-row gap-2 items-center">
          <div class="relative w-full">
            <input
              id="searchInput"
              type="text"
              class="input input-sm input-bordered w-full font-sans"
              placeholder="搜索中文名称、包名或 UID (如 微信, 12123, 淘宝, 银行)..."
            />
          </div>
          <div class="join shrink-0 w-full sm:w-auto justify-end">
            <button class="btn btn-sm join-item btn-active" onclick="setTab('user', this)">第三方应用</button>
            <button class="btn btn-sm join-item" onclick="setTab('bypassed', this)">已排除应用</button>
            <button class="btn btn-sm join-item" onclick="setTab('all', this)">全部应用</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 应用列表容器 -->
    <div id="appList" class="flex flex-col gap-1.5">
      <div class="card bg-base-100/75 backdrop-blur-md border border-base-content/10 p-8 flex items-center justify-center text-base-content/60 text-sm gap-2">
        <span class="loading loading-spinner loading-sm text-primary"></span>
        <span>正在读取手机应用列表...</span>
      </div>
    </div>
  </div>

  <script>
    // 动态同步 Open-Box 父窗口的主题与 CSS 变量 (--app-radius-box, --radius-box 等)
    function syncThemeAndEnv() {
      try {
        const p = window.parent;
        if (p && p.document) {
          const pTheme = p.document.body.getAttribute('data-theme') || p.document.documentElement.getAttribute('data-theme');
          if (pTheme) {
            document.documentElement.setAttribute('data-theme', pTheme);
            document.body.setAttribute('data-theme', pTheme);
          }
          const pApp = p.document.querySelector('#app-content');
          if (pApp) {
            const pStyle = pApp.getAttribute('style') || '';
            document.documentElement.style.cssText = pStyle;
          }
        }
      } catch (e) {}
    }

    syncThemeAndEnv();

    try {
      if (window.parent && window.parent.document && window.parent.document.body) {
        const observer = new MutationObserver(syncThemeAndEnv);
        observer.observe(window.parent.document.body, { attributes: true, attributeFilter: ['data-theme', 'style'] });
      }
    } catch(e) {}

    let allApps = [];
    let bypassSet = new Set();
    let currentTab = 'user';
    let saveTimer = null;

    async function loadData() {
      try {
        const res = await fetch('/api/android/apps');
        const data = await res.json();
        if (data.ok) {
          allApps = data.apps || [];
          bypassSet = new Set(data.bypassUids || []);
          render();
        } else {
          document.getElementById('appList').innerHTML = \`
            <div class="card bg-base-100/75 backdrop-blur-md border border-error/30 p-6 text-error text-center text-sm">
              加载失败: \${data.message || '无权限读取列表'}
            </div>\`;
        }
      } catch (e) {
        document.getElementById('appList').innerHTML = \`
          <div class="card bg-base-100/75 backdrop-blur-md border border-error/30 p-6 text-error text-center text-sm">
            加载失败: \${e.message}
          </div>\`;
      }
    }

    function setTab(tab, btn) {
      currentTab = tab;
      document.querySelectorAll('.join .btn').forEach(b => b.classList.remove('btn-active'));
      if (btn) btn.classList.add('btn-active');
      render();
    }

    function render() {
      const q = document.getElementById('searchInput').value.trim().toLowerCase();
      const listEl = document.getElementById('appList');

      const filtered = allApps.filter(app => {
        const matchQ = !q || 
          app.packageName.toLowerCase().includes(q) || 
          (app.rawName && app.rawName.toLowerCase().includes(q)) || 
          (app.appName && app.appName.toLowerCase().includes(q)) || 
          String(app.uid).includes(q);
        if (!matchQ) return false;
        if (currentTab === 'user') return !app.isSystem || bypassSet.has(app.uid);
        if (currentTab === 'bypassed') return bypassSet.has(app.uid);
        return true;
      });

      if (filtered.length === 0) {
        listEl.innerHTML = \`
          <div class="card bg-base-100/75 backdrop-blur-md border border-base-content/10 p-8 text-center text-base-content/50 text-sm">
            未找到符合条件的应用
          </div>\`;
      } else {
        listEl.innerHTML = filtered.map(app => {
          const isBypassed = bypassSet.has(app.uid);
          return \`
            <div class="card bg-base-100/75 backdrop-blur-md border border-base-content/10 p-3 shadow-2xs hover:border-base-content/25 transition-all">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-sm text-base-content truncate">\${app.appName}</span>
                    \${app.isSystem 
                      ? '<span class="badge badge-warning badge-outline text-[10px] h-4 leading-none">系统</span>' 
                      : '<span class="badge badge-info badge-outline text-[10px] h-4 leading-none">第三方</span>'}
                    \${isBypassed 
                      ? '<span class="badge badge-error text-[10px] h-4 leading-none font-semibold">直连(已排除)</span>' 
                      : '<span class="badge badge-ghost text-base-content/50 text-[10px] h-4 leading-none">走代理</span>'}
                  </div>
                  <div class="text-xs text-base-content/50 font-mono truncate mt-0.5">\${app.packageName} · UID: \${app.uid}</div>
                </div>
                <input 
                  type="checkbox" 
                  class="toggle toggle-sm \${isBypassed ? 'toggle-error' : 'toggle-primary'} shrink-0" 
                  \${isBypassed ? 'checked' : ''} 
                  onchange="onToggleChange(\${app.uid}, this.checked)"
                />
              </div>
            </div>
          \`;
        }).join('');
      }

      document.getElementById('statBadge').innerText = \`已排除: \${bypassSet.size} 款\`;
    }

    function onToggleChange(uid, checked) {
      if (checked) {
        bypassSet.add(uid);
      } else {
        bypassSet.delete(uid);
      }
      render();

      // 防抖自动保存 (300ms 自动生效，无需多余的手动点击，完全对齐 Open-Box 原生体验)
      clearTimeout(saveTimer);
      saveTimer = setTimeout(autoSave, 300);
    }

    async function autoSave() {
      try {
        const res = await fetch('/api/android/bypass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uids: Array.from(bypassSet) })
        });
        const data = await res.json();
        if (data.ok) {
          showToast(\`规则已更新 (已排除 \${data.count} 款应用直连)\`);
        }
      } catch (e) {
        showToast('保存失败: ' + e.message, true);
      }
    }

    function showToast(msg, isError = false) {
      const t = document.getElementById('toast');
      const m = document.getElementById('toastMsg');
      m.innerText = msg;
      t.querySelector('.alert').className = isError 
        ? 'alert alert-error text-xs py-2 px-4 shadow-lg border border-base-content/10 flex items-center gap-2'
        : 'alert alert-success text-xs py-2 px-4 shadow-lg border border-base-content/10 flex items-center gap-2';
      t.classList.remove('opacity-0', 'pointer-events-none', '-translate-y-2');
      setTimeout(() => { 
        t.classList.add('opacity-0', 'pointer-events-none', '-translate-y-2'); 
      }, 2000);
    }

    document.getElementById('searchInput').addEventListener('input', () => render());
    loadData();
  </script>
</body>
</html>`)
  })
}
