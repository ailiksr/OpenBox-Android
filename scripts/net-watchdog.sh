#!/system/bin/sh
# Open-Box Android Network Watchdog (Inspired by Surfing & Box for Magisk)

MODDIR=${0%/*/*}
SCRIPTS_DIR="$MODDIR/scripts"
DATA_DIR="$MODDIR/data"
LOCK_FILE="/dev/tmp/openbox_net_event.lock"
mkdir -p /dev/tmp

check_and_heal() {
    # 仅在内核标记为已启动/自启时进行守护
    [ ! -f "$DATA_DIR/autostart" ] && return 0
    [ ! -f "$MODDIR/etc/config.json" ] && return 0

    # 1. 检查 sing-box 进程
    if ! pgrep -f "$MODDIR/bin/sing-box" >/dev/null; then
        sh "$SCRIPTS_DIR/service-core.sh" start >/dev/null 2>&1
        return 0
    fi

    # 2. 检查内核转发开关 (部分系统如 HyperOS/ColorOS 在切网时会重置)
    local fwd=$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)
    if [ "$fwd" != "1" ]; then
        sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
        sysctl -w net.ipv4.conf.all.route_localnet=1 >/dev/null 2>&1
    fi

    # 3. 检查策略路由规则
    if ! ip rule show | grep -q "lookup 100"; then
        ip rule add fwmark 1 table 100 pref 100 2>/dev/null
        ip route add local default dev lo table 100 2>/dev/null
    fi

    # 4. 检查 iptables 规则链是否被 netd 冲刷
    if ! iptables -t nat -C OUTPUT -p tcp -j OPENBOX_TCP 2>/dev/null; then
        sh "$SCRIPTS_DIR/iptables.sh" start >/dev/null 2>&1
        return 0
    fi

    if ! ip6tables -t filter -C OUTPUT -j OPENBOX_V6 2>/dev/null; then
        sh "$SCRIPTS_DIR/iptables.sh" start >/dev/null 2>&1
        return 0
    fi

    # 5. ColorOS (一加/OPPO/真我) 专属防火墙异常 REJECT 规则自动净化
    local brand=$(getprop ro.product.brand 2>/dev/null | tr '[:upper:]' '[:lower:]')
    case "$brand" in
        oppo|oneplus|realme|oplus)
            for cmd in iptables ip6tables; do
                for chain in fw_INPUT fw_OUTPUT; do
                    $cmd -t filter -nL "$chain" >/dev/null 2>&1 || continue
                    local lines=$($cmd -t filter -nL "$chain" --line-numbers 2>/dev/null | grep "REJECT" | awk '{print $1}' | sort -rn)
                    for line in $lines; do
                        [ -n "$line" ] && [ "$line" -gt 0 ] && $cmd -t filter -D "$chain" "$line" 2>/dev/null
                    done
                done
            done
            ;;
    esac
}

on_net_change() {
    local now=$(date +%s)
    if [ -f "$LOCK_FILE" ]; then
        local last=$(cat "$LOCK_FILE" 2>/dev/null || echo 0)
        [ $((now - last)) -lt 2 ] && return 0
    fi
    echo "$now" > "$LOCK_FILE"

    sleep 1
    check_and_heal
}

# 模式 1：由 inotifyd 触发执行 (参数传入了事件)
if [ -n "$1" ]; then
    on_net_change
    exit 0
fi

# 模式 2：后台常驻守护主进程
pkill -f "inotifyd $0" >/dev/null 2>&1

# 启动 inotifyd 监控安卓网络状态文件 (Surfing 同款)
if [ -d "/data/misc/net" ] && command -v inotifyd >/dev/null 2>&1; then
    nohup inotifyd "$0" "/data/misc/net" >/dev/null 2>&1 &
fi

# 兜底后台循环：每 10 秒巡检一次
while true; do
    sleep 10
    check_and_heal
done
