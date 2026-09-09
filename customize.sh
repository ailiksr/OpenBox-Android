SKIPUNZIP=0

ui_print "****************************************"
ui_print "*        Open-Box for Android          *"
ui_print "*   All-in-one Transparent Proxy       *"
ui_print "*    Powered by sing-box & WebUI       *"
ui_print "****************************************"

if [ "$ARCH" != "arm64" ]; then
    abort "错误: 当前模块仅支持 arm64 架构设备！"
fi

ui_print "- 正在安装 Open-Box 运行时与依赖..."

set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm_recursive "$MODPATH/bin" 0 0 0755 0755
set_perm_recursive "$MODPATH/node/bin" 0 0 0755 0755
set_perm_recursive "$MODPATH/node/lib" 0 0 0755 0755
set_perm_recursive "$MODPATH/scripts" 0 0 0755 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/action.sh" 0 0 0755

mkdir -p "$MODPATH/data"
mkdir -p "$MODPATH/etc"
set_perm_recursive "$MODPATH/data" 0 0 0755 0644
set_perm_recursive "$MODPATH/etc" 0 0 0755 0644

ui_print "- 安装成功！"
ui_print "- 重启后可在手机浏览器打开: http://127.0.0.1:2026"
ui_print "- 或在 SukiSU Ultra 管理器中直接点击模块打开 WebUI"
