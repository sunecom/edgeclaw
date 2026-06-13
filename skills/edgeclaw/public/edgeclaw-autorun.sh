#!/bin/sh
# EdgeClaw 路由器客户端更新脚本
# 功能：杀旧进程 → 删旧文件 → 测网络 → 下载新版 → 启动
# 用法：直接运行 /etc/rc.local，或手动 sh /tmp/monitor_edgeclaw

echo "=============================="
echo " EdgeClaw 客户端更新 v4.1"
echo " 时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================="

# 步骤1: 杀掉旧进程
echo ""
echo "[1/5] 🗑️ 杀掉旧 monitor_edgeclaw 进程..."
OLD_PID=$(ps | grep monitor_edgeclaw | grep -v grep | awk '{print $1}')
if [ -n "$OLD_PID" ]; then
    killall -9 monitor_edgeclaw 2>/dev/null
    sleep 1
    echo "  ✅ 已杀掉进程 PID: $OLD_PID"
else
    echo "  ⏭️  无旧进程需要杀掉"
fi

# 步骤2: 删除旧文件
echo ""
echo "[2/5] 🗑️ 删除旧版文件..."
if [ -f /tmp/monitor_edgeclaw ]; then
    rm /tmp/monitor_edgeclaw
    echo "  ✅ 旧版文件已删除"
else
    echo "  ⏭️  无旧文件需删除"
fi

# 步骤3: 测试网络连通性
echo ""
echo "[3/5] 🌐 测试网络连通性（ping 47.253.201.85）..."
NET_OK=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    ping -c 1 -W 1 47.253.201.85 > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        NET_OK=1
        echo "  ✅ 网络连通（第${i}次尝试成功）"
        break
    fi
    echo "  ⏳ 等待网络...（第${i}次）"
    sleep 1
done

if [ $NET_OK -eq 0 ]; then
    echo "  ❌ 网络不通！请检查路由器网络连接"
    echo ""
    echo "=============================="
    echo " ❌ 更新失败 — 网络不可达"
    echo "=============================="
    exit 1
fi

# 步骤4: 下载最新版
echo ""
echo "[4/5] 📥 下载最新版客户端..."
wget -q http://47.253.201.85:3001/monitor_edgeclaw -O /tmp/monitor_edgeclaw
if [ $? -ne 0 ]; then
    echo "  ❌ 下载失败！请检查服务器是否正常运行"
    echo ""
    echo "=============================="
    echo " ❌ 更新失败 — 下载错误"
    echo "=============================="
    exit 1
fi
chmod +x /tmp/monitor_edgeclaw
FILE_SIZE=$(ls -lh /tmp/monitor_edgeclaw | awk '{print $5}')
echo "  ✅ 下载完成，大小: $FILE_SIZE"

# 步骤5: 启动新版本
echo ""
echo "[5/5] 🚀 启动新版客户端..."
/tmp/monitor_edgeclaw > /tmp/edgeclaw.log 2>&1 &
sleep 1
NEW_PID=$(ps | grep monitor_edgeclaw | grep -v grep | awk '{print $1}')
if [ -n "$NEW_PID" ]; then
    echo "  ✅ 新版客户端已启动，PID: $NEW_PID"
else
    echo "  ❌ 启动失败！请查看 /tmp/edgeclaw.log"
    exit 1
fi

echo ""
echo "=============================="
echo " ✅ 更新完成！"
echo " 设备: $NEW_PID" | head -c 100
echo ""
echo " 日志: tail -f /tmp/edgeclaw.log"
echo "=============================="
