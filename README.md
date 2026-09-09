# OpenBox for Android

<p align="center">
  <b>基于 sing-box 静态内核与 Open-Box 现代 WebUI 的 Android 底层高性能透明代理与应用分流控制器</b>
</p>

<p align="center">
  <a href="#特性与亮点">特性与亮点</a> •
  <a href="#安装与快速上手">安装与使用</a> •
  <a href="#应用分流">应用分流</a> •
  <a href="#致谢与开源参考">致谢与开源参考</a> •
  <a href="#免责声明">免责声明</a>
</p>

---

## <a id="intro"></a><a id="项目定位"></a>📌 项目定位

**OpenBox for Android** 是专为 Android Root 环境（**SukiSU Ultra** / **KernelSU** / **APatch** / **Magisk**）打造的一体化透明代理解决方案。

本项目将优秀的路由器透明代理项目 [Open-Box](https://github.com/liandu2024/Open-Box) 深度移植至 Android 操作系统，移除了所有依赖 OpenWrt（如 `uci`、`procd`、`dnsmasq`）的专有组件，针对移动端特殊的网络协议栈（Android `netd`、FBE 存储加密、多网卡切换、运营商 IPv6 投毒、ColorOS 异常防火墙拦截）进行了系统级的深度重构与加固。

---

## <a id="features"></a><a id="特性与亮点"></a>🚀 特性与亮点

### 1. 混合透明代理架构 (TCP REDIRECT + UDP TPROXY)
* **无需占用系统 VPN 槽位**：底层协议栈直接接管流量，状态栏不显示钥匙图标，不与其他 VPN 工具或局域网工具冲突。
* **极速低延迟**：原生规避了 Linux TUN 虚拟网卡在 Android 上创建默认路由导致崩溃退出的历史缺陷，启动时间 **0.00 秒**。
* **双标记防环路隔离**：内核外发流量打上高位安全标记 `0x20000`，彻底阻断自发流量环路死锁，同时完美兼容 Android 系统的私有路由表。

### 2. 彻底封死运营商 IPv6 DNS 投毒与泄漏
* 国内三大运营商在 5G 蜂窝网络和部分 Wi-Fi 下会默认下发 IPv6 DNS，Android `netd` 会优先使用 IPv6 DNS，导致国外域名遭受投毒污染。
* 本模块在底层 `ip6tables` 中设置了针对 53 端口的防泄漏拦截规则，强制所有 DNS 解析安全回落至内核内置的 Split DNS 进行国内外智能分流。

### 3. 网络热插拔看门狗与重启自愈 (Watchdog)
* **参考成熟项目 [Surfing](https://github.com/GitMetaio/Surfing) 的生命周期设计**：
  * **FBE 存储解密探测**：开机严格等待用户输入锁屏密码、凭据存储解密完成且物理网卡获取到 IP 后，再优雅拉起内核与代理，杜绝无网空转。
  * **inotifyd 事件驱动**：后台监控 `/data/misc/net` 目录。无论手机切换 Wi-Fi、开关飞行模式还是基站重连，看门狗在 10 秒内自动巡检修复底层转发与策略路由。

### 4. 深度适配 ColorOS (一加 / OPPO / 真我) 与各大厂商系统
* 针对 ColorOS 14/15/16 网络防护服务在开机后向 `fw_OUTPUT` 链注入 `REJECT` 拦截规则的痛点，模块看门狗具备机型识别能力，自动定时净化异常规则，保障长期运行永不断网。
* 内置 Android 系统完整的 CA 根证书库，彻底解决 Go 运行库在 HTTPS/TLS 握手时误报未知证书颁发机构的问题。

### 5. 原生现代 WebUI 管理面板 (Vue 3 + DaisyUI + MiSans)
* **SukiSU / KernelSU 内嵌全屏体验**：在管理器中点击模块卡片即可直接打开仪表盘，无需外部浏览器。
* **原生“应用分流（黑名单）”页面**：
  * 直读 Linux `/data/system/packages.list`，毫秒级扫描全机数百款应用。
  * 内置常用金融、网银、社交、手游的中文字典映射，支持中文模糊搜索。
  * 随手拨动开关即自动防抖静默生效，0.1 秒重载规则，网银/国服游戏无损直连基站，彻底免去风控检测困扰。

---

## <a id="install"></a><a id="安装与快速上手"></a>📥 安装与快速上手

### 硬件与系统要求
* **CPU 架构**：`arm64-v8a` (aarch64)
* **系统环境**：Android 10 ~ Android 16
* **Root 管理器**：SukiSU Ultra、KernelSU、APatch、Magisk

### 刷入与启动步骤
1. 前往本仓库的 **[Releases](../../releases)** 页面，下载最新的 `OpenBox-Android-SukiSU-vX.X.X.zip` 刷机包；
2. 打开手机上的 Root 管理器（如 **SukiSU Ultra** 或 **KernelSU**）；
3. 进入 **“模块”** 页面，点击 **“从本地安装”**，选择下载好的 zip 刷机包刷入；
4. 刷入完成后，**重启手机**；
5. 重启解锁屏幕约 5 秒后，打开 SukiSU Ultra 管理器，直接点击 **OpenBox for Android** 模块卡片（或手机浏览器访问 `http://127.0.0.1:2026`）；
6. 首次进入设置管理密码（至少 8 位）；
7. 在 **“订阅管理”** 中粘贴你的 Clash YAML 或分享链接并保存；
8. 在 **“代理”** 页面选择节点或开启“自动择优”，点击右上角 **“部署”** 即可！

---

## <a id="app-bypass"></a><a id="应用分流"></a><a id="应用分流与黑名单"></a>📱 应用分流 (黑名单) 详解

在管理面板中点击底部的 **“设置”** ➔ 顶部第 1 个标签 **“📱 应用分流”**：

* **为什么需要黑名单？**
  * 某些银行、证券或政企 App（如交管12123、个人所得税、建设银行、招商银行等）内部含有极严苛的反代理与防篡改 SDK。
  * 将这类 App 加入黑名单后，Linux 内核会直接命中 `owner UID match RETURN` 规则，数据包在操作系统底层直接走物理基站/宽带直连，**对敏感 App 实现 100% 物理隐身，彻底免疫风控拦截！**
* **操作方式**：
  * 在搜索框中输入中文名（如“微信”、“建行”、“王者”），拨动右侧开关，系统会在 300 毫秒内自动保存并立即重载防火墙生效，无需重启任何服务。

---

## <a id="license"></a><a id="开源协议与版权"></a>⚖️ 开源协议与版权

本项目采用 **[GNU General Public License v3.0 (GPL-3.0)](LICENSE)** 许可证开源。

---

## <a id="credits"></a><a id="致谢与开源参考"></a>🤝 致谢与开源参考 (Credits)

本项目由衷感谢以下开源项目及社区贡献者的杰出工作：

* **[liandu2024/Open-Box](https://github.com/liandu2024/Open-Box)**：提供了优秀的一体化 Web 管理面板、规则编排引擎与路由设计思想；
* **[SagerNet/sing-box](https://github.com/SagerNet/sing-box)**：提供了高性能、通用的通用下一代网络核心底座；
* **[GitMetaio/Surfing](https://github.com/GitMetaio/Surfing)**：在 Android 网络生命周期管理、FBE 存储探测以及 ColorOS 防火墙净化机制上提供了宝贵的技术启发；
* **[tiann/KernelSU](https://github.com/tiann/KernelSU)** & **[SukiSU-Ultra](https://github.com/SukiSU-Ultra/SukiSU-Ultra)**：提供了先进、现代的 Android 内核级 Root 与模块生态。

---

## <a id="disclaimer"></a><a id="免责声明"></a>⚠️ 免责声明 (Disclaimer)

* 本项目仅作为 Linux 网络栈、Android 透明代理与流量分流技术的学习交流与本地网络优化工具；
* 本项目不提供、不内置任何商业代理服务、节点服务器或规则订阅；
* 使用者应当严格遵守当地法律法规，开发者不对任何第三方规则内容或因不当使用造成的任何损失承担法律责任。
