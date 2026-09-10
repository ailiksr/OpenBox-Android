#!/system/bin/sh
MODDIR=${0%/*/*}
NODE="$MODDIR/node/bin/node"
PANEL_SERVER="$MODDIR/panel/server/index.mjs"
LOG="$MODDIR/data/panel.log"

start_panel() {
    mkdir -p "$MODDIR/data"
    cd "$MODDIR/panel"
    export OPENBOX_ROOT="$MODDIR"
    export PORT=2026
    export HOST="0.0.0.0"
    nohup "$NODE" "$PANEL_SERVER" > "$LOG" 2>&1 &
}

stop_panel() {
    pkill -f "$PANEL_SERVER" 2>/dev/null
}

case "$1" in
    start)
        start_panel
        ;;
    stop)
        stop_panel
        ;;
    restart)
        stop_panel
        start_panel
        ;;
    status)
        if pgrep -f "$PANEL_SERVER" >/dev/null; then
            echo "running"
            exit 0
        else
            echo "stopped"
            exit 1
        fi
        ;;
esac
