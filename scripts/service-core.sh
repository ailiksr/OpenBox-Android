#!/system/bin/sh
MODDIR=${0%/*/*}
BIN="$MODDIR/bin/sing-box"
CONF="$MODDIR/etc/config.json"
DATA="$MODDIR/data"
LOG="$DATA/singbox.log"

export SSL_CERT_FILE="$MODDIR/etc/ca-certificates.crt"
ulimit -SHn 1000000 2>/dev/null || ulimit -n 65535 2>/dev/null

start_core() {
    if [ ! -f "$CONF" ]; then
        echo "config not found"
        return 1
    fi
    killall -9 sing-box 2>/dev/null
    nohup "$BIN" run -c "$CONF" -D "$DATA" > "$LOG" 2>&1 &
    sleep 1.5
    sh "$MODDIR/scripts/iptables.sh" start
    echo "running"
}

stop_core() {
    sh "$MODDIR/scripts/iptables.sh" stop 2>/dev/null
    killall -9 sing-box 2>/dev/null
    echo "stopped"
}

case "$1" in
    start)
        start_core
        ;;
    stop)
        stop_core
        ;;
    restart)
        stop_core
        start_core
        ;;
    status)
        if pgrep -f "$BIN" >/dev/null; then
            echo "running"
            exit 0
        else
            echo "stopped"
            exit 1
        fi
        ;;
    enabled)
        if [ -f "$DATA/autostart" ]; then
            exit 0
        else
            exit 1
        fi
        ;;
    enable)
        mkdir -p "$DATA"
        touch "$DATA/autostart"
        ;;
    disable)
        rm -f "$DATA/autostart"
        ;;
esac
