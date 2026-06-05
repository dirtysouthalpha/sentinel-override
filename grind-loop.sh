#!/bin/bash
# Sentinel Override Grind Loop — Dad's Mini PC
# Runs Claude Code indefinitely with Max plan, grinding toward perfection

REPO_DIR="$HOME/Projects/sentinel-override"
LOG_DIR="$HOME/grind-logs"
mkdir -p "$LOG_DIR"

while true; do
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    LOGFILE="$LOG_DIR/grind-${TIMESTAMP}.log"
    
    echo "[$(date)] Starting grind session..." | tee -a "$LOGFILE"
    
    cd "$REPO_DIR"
    
    # Pull latest before starting
    git pull origin main 2>&1 | tee -a "$LOGFILE"
    
    # Clean aider artifacts from previous sessions
    rm -rf .aider.chat.history.md .aider.input.history .aider.tags.cache.v4/ coverage/ 2>/dev/null
    
    # Run Claude Code with 500 turns per session
    claude -p "Read CLAUDE.md and follow the instructions. Start from Phase 1 and work through each phase systematically. After EVERY change: run tests, then commit with conventional commit message. Push after every 3-5 commits. Focus on making the extension bulletproof and better than Claude in Chrome." \
        --allowedTools "Read,Write,Edit,Bash" \
        --dangerously-skip-permissions \
        --max-turns 500 \
        --model sonnet \
        2>&1 | tee -a "$LOGFILE"
    
    EXIT_CODE=$?
    echo "[$(date)] Session ended (exit=$EXIT_CODE). Restarting in 60s..." | tee -a "$LOGFILE"
    
    # Compress old logs (keep last 10)
    cd "$LOG_DIR"
    ls -t grind-*.log | tail -n +11 | xargs -r rm
    
    sleep 60
done
