#!/bin/bash
#
# OPC Worker 启动模板 - Coder
# 包含：隔离目录创建、心跳上报、超时保护、清理
#

set -euo pipefail  # 严格模式

# ===== 配置 =====
TASK_ID="${1:-UNKNOWN}"
TASK_TYPE="${2:-feature}"
WORKER_TYPE="coder"
TIMEOUT_SECONDS="${OPC_TIMEOUT:-1800}"  # 默认30分钟
STATE_DB="${OPC_STATE_DB:-$HOME/.openclaw/workspace/opc-pipeline/state/pipeline.db}"
MAIN_PROJECT="${OPC_PROJECT_DIR:-$HOME/.openclaw/workspace}"

# ===== 函数 =====

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$WORKER_TYPE] $1" | tee -a /tmp/opc-worker-${TASK_ID}.log
}

update_status() {
    local status="$1"
    local message="${2:-}"
    
    sqlite3 "$STATE_DB" <<EOF
UPDATE tasks SET 
    status = '$status',
    checkpoint_at = $(date +%s)000,
    worker_pid = $$
WHERE task_id = '$TASK_ID';

INSERT INTO task_logs (task_id, stage, status, message, timestamp)
VALUES ('$TASK_ID', '$WORKER_TYPE', '$status', '$message', $(date +%s)000);
EOF
}

heartbeat_loop() {
    while true; do
        sleep 60
        sqlite3 "$STATE_DB" "UPDATE tasks SET checkpoint_at = $(date +%s)000 WHERE task_id = '$TASK_ID';"
    done &
    HEARTBEAT_PID=$!
}

cleanup() {
    log "Cleanup triggered"
    
    # 停止心跳
    if [[ -n "${HEARTBEAT_PID:-}" ]]; then
        kill $HEARTBEAT_PID 2>/dev/null || true
    fi
    
    # 清理隔离目录
    if [[ -n "${ISOLATION_DIR:-}" && -d "$ISOLATION_DIR" ]]; then
        rm -rf "$ISOLATION_DIR"
        log "Removed isolation dir: $ISOLATION_DIR"
    fi
    
    # 更新状态（如果是异常退出）
    if [[ "${1:-0}" != "0" ]]; then
        update_status "failed" "Worker exited with code $1"
    fi
}

trap cleanup EXIT

# ===== 主流程 =====

log "Starting worker for task: $TASK_ID"

# 1. 创建隔离目录
ISOLATION_DIR=$(mktemp -d /tmp/opc-${TASK_ID}-XXXXXX)
log "Isolation dir: $ISOLATION_DIR"

# 2. 更新状态为运行中
update_status "coding" "Worker started, PID: $$"

# 3. 同步代码
log "Syncing project files..."
if command -v git &> /dev/null && [[ -d "$MAIN_PROJECT/.git" ]]; then
    git clone --depth 1 "file://$MAIN_PROJECT" "$ISOLATION_DIR/src" 2>/dev/null || \
    cp -r "$MAIN_PROJECT" "$ISOLATION_DIR/src"
else
    cp -r "$MAIN_PROJECT" "$ISOLATION_DIR/src"
fi

# 写入上下文
context_file="$ISOLATION_DIR/.opc-context.json"
cat > "$context_file" <<EOF
{
  "taskId": "$TASK_ID",
  "taskType": "$TASK_TYPE",
  "workerType": "$WORKER_TYPE",
  "isolationDir": "$ISOLATION_DIR",
  "startedAt": "$(date -Iseconds)",
  "mainProject": "$MAIN_PROJECT",
  "constraints": [
    "在隔离目录工作: $ISOLATION_DIR/src",
    "完成后使用 git diff 生成 patch",
    "不要修改主项目文件"
  ]
}
EOF

# 4. 启动心跳
heartbeat_loop

# 5. 设置超时
(
    sleep $TIMEOUT_SECONDS
    log "TIMEOUT after ${TIMEOUT_SECONDS}s, killing worker"
    kill -TERM $$ 2>/dev/null || true
    sleep 5
    kill -KILL $$ 2>/dev/null || true
) &
TIMEOUT_PID=$!

# 6. 执行实际工作（这里会被具体的 AI 调用替换）
log "Worker ready. Isolation dir: $ISOLATION_DIR/src"
log "Context file: $context_file"

# 保持运行直到外部信号
while true; do
    sleep 1
done
