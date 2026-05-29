#!/bin/bash
# Override Perfection Grind — Claude Max Sonnet 4.6
REPO_DIR="$HOME/Projects/sentinel-override"
BRANCH="main"
LOG_DIR="$HOME/grind-logs"
mkdir -p "$LOG_DIR"

while true; do
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    LOGFILE="$LOG_DIR/override-perfect-${TIMESTAMP}.log"
    echo "[$(date)] Starting perfection grind session..." | tee -a "$LOGFILE"
    cd "$REPO_DIR"
    git pull origin "$BRANCH" 2>&1 | tee -a "$LOGFILE"
    rm -rf .aider.chat.history.md .aider.input.history .aider.tags.cache.v4/ coverage/ 2>/dev/null
    claude -p "Read CLAUDE.md and follow the instructions. Start with Phase 1 (tests), then Phase 2 (big files). Be thorough and aggressive — fix everything you find. Run tests after EVERY change. Do not skip any phase." \
        --dangerously-skip-permissions \
        --max-turns 500 \
        --model claude-sonnet-4-6 \
        --allowedTools "Bash,Read,Write,Edit,MultiEdit" \
        2>&1 | tee -a "$LOGFILE"
    echo "[$(date)] Session ended. Restarting in 60s..." | tee -a "$LOGFILE"
    cd "$LOG_DIR" && ls -t override-perfect-*.log | tail -n +11 | xargs -r rm
    sleep 60
done
