#!/system/bin/sh
# Open-Box Android App Bypass Helper (手机端快速增删黑名单)

MODDIR=${0%/*/*}
DATA_DIR="$MODDIR/data"
BYPASS_FILE="$DATA_DIR/bypass_uids.txt"
IPTABLES_SCRIPT="$MODDIR/scripts/iptables.sh"

mkdir -p "$DATA_DIR"
touch "$BYPASS_FILE"

reload_rules() {
    echo "正在重新加载防火墙规则..."
    sh "$IPTABLES_SCRIPT" start >/dev/null 2>&1
    echo "✔ 防火墙规则已更新，所选应用已立即绕过代理！"
}

show_current() {
    echo "----------------------------------------"
    echo "  当前已加入黑名单 (直连) 的应用 UID:  "
    echo "----------------------------------------"
    if [ ! -s "$BYPASS_FILE" ]; then
        echo "  (暂无已排除的应用)"
    else
        while read -r uid; do
            [ -z "$uid" ] || echo "$uid" | grep -q "^#" && continue
            # 查询对应的包名
            local pkgs=$(pm list packages -U 2>/dev/null | grep "uid:$uid" | awk -F':' '{print $2}' | awk '{print $1}')
            echo "  • UID: $uid  ->  ${pkgs:-[未知应用]}"
        done < "$BYPASS_FILE"
    fi
    echo "----------------------------------------"
}

add_by_keyword() {
    local kw="$1"
    echo "正在搜索包含 '$kw' 的应用..."
    local matches=$(pm list packages -U 2>/dev/null | grep -i "$kw")
    if [ -z "$matches" ]; then
        echo "❌ 未找到与 '$kw' 匹配的应用。"
        return 1
    fi

    echo "找到以下匹配项:"
    echo "$matches" | while read -r line; do
        local pkg=$(echo "$line" | awk -F':' '{print $2}' | awk '{print $1}')
        local uid=$(echo "$line" | awk -F'uid:' '{print $2}')
        if [ -n "$uid" ]; then
            if grep -q "^$uid$" "$BYPASS_FILE" 2>/dev/null; then
                echo "  [已在列表中] $pkg (UID: $uid)"
            else
                echo "$uid" >> "$BYPASS_FILE"
                echo "  ✔ [已成功添加] $pkg (UID: $uid)"
            fi
        fi
    done

    # 排序去重
    sort -u "$BYPASS_FILE" -o "$BYPASS_FILE" 2>/dev/null
    reload_rules
}

if [ -n "$1" ]; then
    add_by_keyword "$1"
    exit 0
fi

show_current
echo ""
echo "请输入需要排除的应用包名或关键字 (如 bank, tencent, wechat, 或者直接输 UID):"
read -r input
if [ -n "$input" ]; then
    add_by_keyword "$input"
fi
