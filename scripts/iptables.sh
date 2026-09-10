#!/system/bin/sh
# Open-Box for Android Transparent Proxy (TCP REDIRECT + UDP TPROXY + Tethering Hotspot Support)

MODDIR=${0%/*/*}
SELF_MARK=0x20000
TPROXY_MARK=1
TABLE_ID=100
TPROXY_UDP_PORT=7895
REDIR_TCP_PORT=7892
DATA_DIR="$MODDIR/data"

start_rules() {
    stop_rules >/dev/null 2>&1

    # 1. 开启内核网络转发与本地网回环转发，优化 TCP 连接超时 (防止蜂窝网络死连接积压)
    sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
    sysctl -w net.ipv4.conf.all.route_localnet=1 >/dev/null 2>&1
    sysctl -w net.netfilter.nf_conntrack_tcp_timeout_established=7200 >/dev/null 2>&1

    # 2. TCP REDIRECT (nat 表)
    # 2.1 外部客户端链 OPENBOX_PRE_TCP (专为 Wi-Fi 热点 / USB网络共享客户端设计，不含 -m owner)
    iptables -t nat -N OPENBOX_PRE_TCP 2>/dev/null
    iptables -t nat -F OPENBOX_PRE_TCP
    iptables -t nat -A OPENBOX_PRE_TCP -m mark --mark $SELF_MARK -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -p tcp --dport 53 -j REDIRECT --to-ports $REDIR_TCP_PORT
    iptables -t nat -A OPENBOX_PRE_TCP -d 0.0.0.0/8 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -d 10.0.0.0/8 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -d 127.0.0.0/8 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -d 169.254.0.0/16 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -d 172.16.0.0/12 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -d 192.168.0.0/16 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -d 224.0.0.0/4 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -d 240.0.0.0/4 -j RETURN
    iptables -t nat -A OPENBOX_PRE_TCP -p tcp -j REDIRECT --to-ports $REDIR_TCP_PORT
    iptables -t nat -I PREROUTING -p tcp -j OPENBOX_PRE_TCP

    # 2.2 本机 App 链 OPENBOX_TCP (包含 -m owner UID 识别与黑名单绕过)
    iptables -t nat -N OPENBOX_TCP 2>/dev/null
    iptables -t nat -F OPENBOX_TCP
    iptables -t nat -A OPENBOX_TCP -m mark --mark $SELF_MARK -j RETURN
    iptables -t nat -A OPENBOX_TCP -m owner --uid-owner 0 -j RETURN
    iptables -t nat -A OPENBOX_TCP -p tcp --dport 53 -j REDIRECT --to-ports $REDIR_TCP_PORT
    iptables -t nat -A OPENBOX_TCP -d 0.0.0.0/8 -j RETURN
    iptables -t nat -A OPENBOX_TCP -d 10.0.0.0/8 -j RETURN
    iptables -t nat -A OPENBOX_TCP -d 127.0.0.0/8 -j RETURN
    iptables -t nat -A OPENBOX_TCP -d 169.254.0.0/16 -j RETURN
    iptables -t nat -A OPENBOX_TCP -d 172.16.0.0/12 -j RETURN
    iptables -t nat -A OPENBOX_TCP -d 192.168.0.0/16 -j RETURN
    iptables -t nat -A OPENBOX_TCP -d 224.0.0.0/4 -j RETURN
    iptables -t nat -A OPENBOX_TCP -d 240.0.0.0/4 -j RETURN

    if [ -f "$DATA_DIR/bypass_uids.txt" ]; then
        for uid in $(grep -E '^[0-9]+$' "$DATA_DIR/bypass_uids.txt" 2>/dev/null); do
            [ -n "$uid" ] && iptables -t nat -A OPENBOX_TCP -m owner --uid-owner "$uid" -j RETURN
        done
    fi

    iptables -t nat -A OPENBOX_TCP -p tcp -j REDIRECT --to-ports $REDIR_TCP_PORT
    iptables -t nat -I OUTPUT -p tcp -j OPENBOX_TCP

    # 3. UDP TPROXY (mangle 表，同时接管本地与热点/共享网络的 UDP 与 DNS)
    ip rule add fwmark $TPROXY_MARK table $TABLE_ID pref 100 2>/dev/null
    ip route add local default dev lo table $TABLE_ID 2>/dev/null

    # PREROUTING 链：处理所有进入本机的外部 UDP 流量 (热点/USB客户端发来的包) 以及 本机经过重路由的包
    iptables -t mangle -N OPENBOX_PRE 2>/dev/null
    iptables -t mangle -F OPENBOX_PRE
    iptables -t mangle -A OPENBOX_PRE -m mark --mark $SELF_MARK -j RETURN
    iptables -t mangle -A OPENBOX_PRE -p udp --dport 53 -j TPROXY --on-port $TPROXY_UDP_PORT --tproxy-mark $TPROXY_MARK
    iptables -t mangle -A OPENBOX_PRE -d 0.0.0.0/8 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 10.0.0.0/8 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 127.0.0.0/8 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 169.254.0.0/16 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 172.16.0.0/12 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 192.168.0.0/16 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 224.0.0.0/4 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 240.0.0.0/4 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -d 255.255.255.255/32 -j RETURN
    iptables -t mangle -A OPENBOX_PRE -p udp -j TPROXY --on-port $TPROXY_UDP_PORT --tproxy-mark $TPROXY_MARK
    iptables -t mangle -I PREROUTING -p udp -j OPENBOX_PRE

    # OUTPUT 链：专门处理手机本机 App 发出的 UDP 流量
    iptables -t mangle -N OPENBOX_UDP 2>/dev/null
    iptables -t mangle -F OPENBOX_UDP
    iptables -t mangle -A OPENBOX_UDP -m mark --mark $SELF_MARK -j RETURN
    iptables -t mangle -A OPENBOX_UDP -p udp --dport 53 -j MARK --set-mark $TPROXY_MARK
    iptables -t mangle -A OPENBOX_UDP -d 0.0.0.0/8 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 10.0.0.0/8 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 127.0.0.0/8 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 169.254.0.0/16 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 172.16.0.0/12 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 192.168.0.0/16 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 224.0.0.0/4 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 240.0.0.0/4 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -d 255.255.255.255/32 -j RETURN

    if [ -f "$DATA_DIR/bypass_uids.txt" ]; then
        for uid in $(grep -E '^[0-9]+$' "$DATA_DIR/bypass_uids.txt" 2>/dev/null); do
            [ -n "$uid" ] && iptables -t mangle -A OPENBOX_UDP -m owner --uid-owner "$uid" -j RETURN
        done
    fi

    iptables -t mangle -A OPENBOX_UDP -m owner --uid-owner 0 -j RETURN
    iptables -t mangle -A OPENBOX_UDP -p udp -j MARK --set-mark $TPROXY_MARK
    iptables -t mangle -I OUTPUT -p udp -j OPENBOX_UDP

    # 4. 彻底解决 Android 运营商 IPv6 DNS 投毒泄漏问题
    ip6tables -t filter -N OPENBOX_V6 2>/dev/null
    ip6tables -t filter -F OPENBOX_V6
    ip6tables -t filter -A OPENBOX_V6 -p udp --dport 53 -j REJECT
    ip6tables -t filter -A OPENBOX_V6 -p tcp --dport 53 -j REJECT
    ip6tables -t filter -D OUTPUT -j OPENBOX_V6 2>/dev/null
    ip6tables -t filter -I OUTPUT -j OPENBOX_V6

    # 5. 开启移动基站/蜂窝网络 TCP MSS 自动钳制 (防止移动网络 MTU 1400 报文分片黑洞)
    iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null
}

stop_rules() {
    iptables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null
    iptables -t nat -D OUTPUT -p tcp -j OPENBOX_TCP 2>/dev/null
    iptables -t nat -D PREROUTING -p tcp -j OPENBOX_PRE_TCP 2>/dev/null
    iptables -t nat -F OPENBOX_TCP 2>/dev/null
    iptables -t nat -X OPENBOX_TCP 2>/dev/null
    iptables -t nat -F OPENBOX_PRE_TCP 2>/dev/null
    iptables -t nat -X OPENBOX_PRE_TCP 2>/dev/null

    iptables -t mangle -D PREROUTING -p udp -j OPENBOX_PRE 2>/dev/null
    iptables -t mangle -D OUTPUT -p udp -j OPENBOX_UDP 2>/dev/null
    iptables -t mangle -F OPENBOX_PRE 2>/dev/null
    iptables -t mangle -X OPENBOX_PRE 2>/dev/null
    iptables -t mangle -F OPENBOX_UDP 2>/dev/null
    iptables -t mangle -X OPENBOX_UDP 2>/dev/null

    ip6tables -t filter -D OUTPUT -j OPENBOX_V6 2>/dev/null
    ip6tables -t filter -F OPENBOX_V6 2>/dev/null
    ip6tables -t filter -X OPENBOX_V6 2>/dev/null

    ip rule del fwmark $TPROXY_MARK table $TABLE_ID 2>/dev/null
    ip route del local default dev lo table $TABLE_ID 2>/dev/null
    ip route flush cache 2>/dev/null
}

case "$1" in
    start) start_rules ;;
    stop) stop_rules ;;
esac
