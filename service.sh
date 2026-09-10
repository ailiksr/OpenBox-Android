#!/system/bin/sh
# Open-Box Android Boot Service (Inspired by Surfing)

MODDIR=${0%/*}
SCRIPTS_DIR="$MODDIR/scripts"

wait_until_ready() {
    # 1. 等待 Android 基础系统启动完成
    while [ "$(getprop sys.boot_completed)" != "1" ]; do
        sleep 2
    done

    # 2. 等待 FBE 存储解密与用户空间就绪 (Surfing 同款机制)
    local test_file="/sdcard/Android/.OPENBOXTEST"
    until [ -d "/sdcard/Android" ]; do
        sleep 1
    done
    true > "$test_file" 2>/dev/null
    while [ ! -f "$test_file" ]; do
        true > "$test_file" 2>/dev/null
        sleep 1
    done
    rm -f "$test_file" 2>/dev/null

    # 3. 等待网络路由接口就绪 (最多等待 15 秒)
    local wait_net=0
    while [ "$wait_net" -lt 15 ]; do
        if ip route show | grep -E "wlan|rmnet" >/dev/null 2>&1; then
            break
        fi
        sleep 1
        wait_net=$((wait_net + 1))
    done
    sleep 2
}

# 后台异步启动，避免阻塞 SukiSU / Magisk 的启动引导链
(
    wait_until_ready

    # 1. 启动 WebUI 后端面板
    sh "$SCRIPTS_DIR/service-panel.sh" start

    # 2. 检查配置，启动 sing-box 内核与透明代理 (开机自启)
    if [ -f "$MODDIR/etc/config.json" ] && [ ! -f "$MODDIR/data/disabled" ]; then
        sh "$SCRIPTS_DIR/service-core.sh" start
    fi

    # 3. 启动网络热插拔监控看门狗
    nohup sh "$SCRIPTS_DIR/net-watchdog.sh" >/dev/null 2>&1 &
) &
