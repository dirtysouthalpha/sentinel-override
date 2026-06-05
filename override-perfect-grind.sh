#!/bin/bash
# Override Perfection Grind — Local RTX 2070 (qwen2.5-coder:7b via Ollama)
REPO_DIR="$HOME/Projects/sentinel-override"
BRANCH="main"
LOG_DIR="$HOME/grind-logs"
mkdir -p "$LOG_DIR"

while true; do
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    LOGFILE="$LOG_DIR/override-perfect-${TIMESTAMP}.log"
    echo "[$(date)] Starting LOCAL 2070 grind session (qwen2.5-coder:7b)..." | tee -a "$LOGFILE"
    cd "$REPO_DIR"
    git pull origin "$BRANCH" 2>&1 | tee -a "$LOGFILE"
    rm -rf .aider.chat.history.md .aider.input.history .aider.tags.cache.v4/ coverage/ 2>/dev/null

    claude -p "You are grinding on sentinel-override Chrome extension. Focus on:
1. Fixing open GitHub issues (check with: curl -s https://api.github.com/repos/DirtySouthAlpha/sentinel-override/issues?state=open | python3 -c \"import sys,json; [print(f\\\"#{i[\\\"number\\\"]} {i[\\\"title\\\"]}\\\") for i in json.load(sys.stdin)]\")
2. Adding missing test coverage for error paths
3. Performance optimizations (caching, reducing I/O, removing redundant loops)
4. Code health (removing dead code, improving error messages, consistency)

Rules:
- Run npm test after EVERY change. If tests fail, fix immediately.
- NEVER use --detectOpenHandles (it hangs).
- Push after every 3-5 commits.
- Check for TODO/FIXME comments and resolve them.
- Look for uncaught exceptions, missing null checks, and edge cases.
- Be thorough and aggressive — fix everything you find." \
        --dangerously-skip-permissions \
        --max-turns 500 \
        --model claude-sonnet-4-6 \
        --allowedTools "Bash,Read,Write,Edit,MultiEdit" \
        2>&1 | tee -a "$LOGFILE"

    # Post-session verification
    echo "[$(date)] Running post-session test verification..." | tee -a "$LOGFILE"
    npm test 2>&1 | tail -5 | tee -a "$LOGFILE"

    # Push any unpushed commits
    git push origin "$BRANCH" 2>&1 | tee -a "$LOGFILE"

    echo "[$(date)] Session ended. Restarting in 60s..." | tee -a "$LOGFILE"
    cd "$LOG_DIR" && ls -t override-perfect-*.log | tail -n +11 | xargs -r rm
    sleep 60
done
