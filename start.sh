#!/bin/bash
#
# OPC Pipeline 启动脚本
# 启动所有静态 Actor 和主控
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE_DIR="${SCRIPT_DIR}"
VAR_DIR="${PIPELINE_DIR}/var"
PID_DIR="${VAR_DIR}/pids"
LOG_DIR="${VAR_DIR}/logs"

# 创建必要目录
mkdir -p "${PID_DIR}" "${LOG_DIR}" "${VAR_DIR}/pipe" "${VAR_DIR}/workers"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
    log "${RED}ERROR: $1${NC}"
}

success() {
    log "${GREEN}SUCCESS: $1${NC}"
}

warning() {
    log "${YELLOW}WARNING: $1${NC}"
}

# 检查 Actor 是否已在运行
check_running() {
    local name=$1
    local pid_file="${PID_DIR}/${name}.pid"
    
    if [[ -f "${pid_file}" ]]; then
        local pid=$(cat "${pid_file}")
        if kill -0 "${pid}" 2>/dev/null; then
            return 0  # 正在运行
        fi
    fi
    return 1  # 未运行
}

# 启动单个 Actor
start_actor() {
    local name=$1
    local script=$2
    local pid_file="${PID_DIR}/${name}.pid"
    local log_file="${LOG_DIR}/${name}.log"
    
    if check_running "${name}"; then
        warning "${name} 已在运行 (PID: $(cat "${pid_file}"))"
        return 0
    fi
    
    log "启动 ${name}..."
    
    nohup node "${script}" > "${log_file}" 2>&1 &
    local pid=$!
    
    # 等待确认启动
    sleep 1
    if kill -0 "${pid}" 2>/dev/null; then
        echo "${pid}" > "${pid_file}"
        success "${name} 启动成功 (PID: ${pid})"
        return 0
    else
        error "${name} 启动失败"
        return 1
    fi
}

# 停止单个 Actor
stop_actor() {
    local name=$1
    local pid_file="${PID_DIR}/${name}.pid"
    
    if [[ ! -f "${pid_file}" ]]; then
        warning "${name} 未运行"
        return 0
    fi
    
    local pid=$(cat "${pid_file}")
    log "停止 ${name} (PID: ${pid})..."
    
    # 优雅终止
    if kill -0 "${pid}" 2>/dev/null; then
        kill -TERM "${pid}" 2>/dev/null || true
        sleep 2
        
        # 强制终止如果还在运行
        if kill -0 "${pid}" 2>/dev/null; then
            warning "${name} 未响应，强制终止..."
            kill -KILL "${pid}" 2>/dev/null || true
        fi
    fi
    
    rm -f "${pid_file}"
    success "${name} 已停止"
}

# 启动所有组件
start_all() {
    log "========== OPC Pipeline 启动 =========="
    
    # 启动静态 Actor
    start_actor "coder-actor" "${PIPELINE_DIR}/actors/coder-actor.js"
    start_actor "reviewer-actor" "${PIPELINE_DIR}/actors/reviewer-actor.js"
    start_actor "tester-actor" "${PIPELINE_DIR}/actors/tester-actor.js"
    
    success "所有 Actor 已启动"
    log ""
    log "使用方式:"
    log "  1. 创建任务: node ${PIPELINE_DIR}/examples/create-task.js"
    log "  2. 查看状态: node ${PIPELINE_DIR}/examples/check-status.js"
    log "  3. 停止所有: ${0} stop"
}

# 停止所有组件
stop_all() {
    log "========== OPC Pipeline 停止 =========="
    
    stop_actor "coder-actor"
    stop_actor "reviewer-actor"
    stop_actor "tester-actor"
    
    success "所有 Actor 已停止"
}

# 查看状态
status() {
    log "========== OPC Pipeline 状态 =========="
    
    local actors=("coder-actor" "reviewer-actor" "tester-actor")
    local running=0
    local stopped=0
    
    for actor in "${actors[@]}"; do
        if check_running "${actor}"; then
            local pid=$(cat "${PID_DIR}/${actor}.pid")
            log "${GREEN}●${NC} ${actor}: 运行中 (PID: ${pid})"
            ((running++))
        else
            log "${RED}●${NC} ${actor}: 未运行"
            ((stopped++))
        fi
    done
    
    log ""
    log "运行中: ${running}, 已停止: ${stopped}"
}

# 清理管道目录（慎用）
cleanup() {
    warning "这将清理所有管道目录和临时文件"
    read -p "确定继续? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log "清理中..."
        rm -rf "${VAR_DIR}/pipe"/*
        rm -rf "${VAR_DIR}/workers"/*
        success "清理完成"
    else
        log "已取消"
    fi
}

# 主命令
case "${1:-}" in
    start)
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        stop_all
        sleep 2
        start_all
        ;;
    status)
        status
        ;;
    cleanup)
        cleanup
        ;;
    *)
        echo "OPC Pipeline 管理脚本"
        echo ""
        echo "用法: $0 {start|stop|restart|status|cleanup}"
        echo ""
        echo "命令:"
        echo "  start    启动所有 Actor"
        echo "  stop     停止所有 Actor"
        echo "  restart  重启所有 Actor"
        echo "  status   查看运行状态"
        echo "  cleanup  清理管道目录（慎用）"
        exit 1
        ;;
esac
