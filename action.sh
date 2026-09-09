#!/system/bin/sh
MODDIR=${0%/*}

echo "=========================================="
echo "      Open-Box for Android (SukiSU)       "
echo "=========================================="

if pgrep -f "$MODDIR/bin/sing-box" >/dev/null; then
    PID=$(pgrep -f "$MODDIR/bin/sing-box" | head -n 1)
    echo "当前状态: [运行中] (PID: $PID)"
    echo "正在停止内核与网络接管..."
    pkill -f "$MODDIR/scripts/net-watchdog.sh" >/dev/null 2>&1
    sh "$MODDIR/scripts/service-core.sh" stop
    echo "已成功停止 sing-box，所有 iptables 规则已清除！"
    echo "手机网络已完全恢复直连。"
else
    echo "当前状态: [已停止]"
    if [ -f "$MODDIR/etc/config.json" ]; then
        echo "正在启动 sing-box 内核与透明代理..."
        sh "$MODDIR/scripts/service-core.sh" start
        nohup sh "$MODDIR/scripts/net-watchdog.sh" >/dev/null 2>&1 &
        echo "Open-Box 已成功启动！网络看门狗已激活。"
    else
        echo "提示: 尚未检测到配置文件 (etc/config.json)。"
        echo "请打开管理面板 http://127.0.0.1:2026 导入订阅并点击「部署」！"
    fi
fi
echo "=========================================="
