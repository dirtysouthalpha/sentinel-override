#!/bin/bash
# Local 2070 Grind — Ollama API + jq (no Python deps)
REPO_DIR="$HOME/Projects/sentinel-override"
BRANCH="main"
LOG_DIR="$HOME/grind-logs"
OLLAMA_API="http://localhost:11434"
mkdir -p "$LOG_DIR"

# Fetch open issues via API
fetch_open_issues() {
    curl -s "https://api.github.com/repos/DirtySouthAlpha/sentinel-override/issues?state=open" | jq -r ".[] | \"#\(.number) | \(.title) | \(.body // \"\" | .[0:100])\"" 2>/dev/null || echo "FAILED"
}

# Call Ollama for fix suggestion
call_ollama() {
    local prompt="$1"
    curl -s "$OLLAMA_API/api/generate" -d "{\"model\":\"qwen2.5-coder:7b\",\"prompt\":\"$prompt\",\"stream\":false}" 2>/dev/null | jq -r ".response" 2>/dev/null || echo ""
}

# Main grind loop
while true; do
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    LOGFILE="$LOG_DIR/local-2070-grind-${TIMESTAMP}.log"
    echo "[$(date)] Starting LOCAL 2070 grind session (Ollama qwen2.5-coder:7b)..." | tee -a "$LOGFILE"
    cd "$REPO_DIR"
    git pull origin "$BRANCH" 2>&1 | tee -a "$LOGFILE"

    # Fetch open issues
    echo "[$(date)] Fetching open issues..." | tee -a "$LOGFILE"
    ISSUES=$(fetch_open_issues)
    echo "$ISSUES" | head -5 >> "$LOGFILE"

    if [[ "$ISSUES" == *"FAILED"* ]]; then
        echo "[$(date)] Failed to fetch issues, skipping..." | tee -a "$LOGFILE"
        sleep 300
        continue
    fi

    # Pick an issue (round-robin via file state)
    ISSUE_FILE="$LOG_DIR/current_issue.txt"
    if [ -f "$ISSUE_FILE" ]; then
        CURRENT=$(cat "$ISSUE_FILE")
        NEXT=$(echo "$ISSUES" | grep -A1 "$CURRENT" | tail -1)
    fi
    if [[ -z "$NEXT" || "$NEXT" == "$CURRENT" ]]; then
        NEXT=$(echo "$ISSUES" | head -1)
    fi
    echo "$NEXT" > "$ISSUE_FILE"

    ISSUE_NUM=$(echo "$NEXT" | cut -d"|" -f1 | tr -d "#")
    ISSUE_TITLE=$(echo "$NEXT" | cut -d"|" -f2)
    ISSUE_BODY=$(echo "$NEXT" | cut -d"|" -f3-)

    if [[ -z "$ISSUE_NUM" ]]; then
        echo "[$(date)] No open issues, sleeping 5 min..." | tee -a "$LOGFILE"
        sleep 300
        continue
    fi

    echo "[$(date)] Working on issue #$ISSUE_NUM: $ISSUE_TITLE" | tee -a "$LOGFILE"

    # Generate fix via Ollama
    PROMPT="You are fixing GitHub issue #$ISSUE_NUM: $ISSUE_TITLE\\n\\nIssue description:\\n$ISSUE_BODY\\n\\nRespond with a single bash command that fixes this issue. Output ONLY the command, no explanation. Examples:\\n\\n1. sed -i s/old/new/g file.js\\n2. node --check file.js\\n3. npm test -- --testPathPattern=xyz"

    FIX=$(call_ollama "$PROMPT")
    if [[ -z "$FIX" ]]; then
        echo "[$(date)] Ollama returned empty response, retrying..." | tee -a "$LOGFILE"
        sleep 60
        continue
    fi

    echo "[$(date)] Executing: $FIX" | tee -a "$LOGFILE"
    cd "$REPO_DIR"
    eval "$FIX" 2>&1 | tee -a "$LOGFILE"

    # Verify with tests
    echo "[$(date)] Running tests..." | tee -a "$LOGFILE"
    npm test 2>&1 | tail -5 >> "$LOGFILE"
    TEST_EXIT=${PIPESTATUS[0]}

    # Commit if tests pass and there are changes
    if [[ $TEST_EXIT -eq 0 ]] && ! git diff-index --quiet HEAD --; then
        COMMIT_MSG="fix: #$ISSUE_NUM $ISSUE_TITLE"
        echo "[$(date)] Tests passed, committing: $COMMIT_MSG" | tee -a "$LOGFILE"
        git add -A 2>&1 | tee -a "$LOGFILE"
        git commit -m "$COMMIT_MSG" 2>&1 | tee -a "$LOGFILE"
        git push origin "$BRANCH" 2>&1 | tee -a "$LOGFILE"
        echo "[$(date)] ✅ Committed and pushed" | tee -a "$LOGFILE"
    else
        echo "[$(date)] Tests failed or no changes, skipping commit" | tee -a "$LOGFILE"
    fi

    echo "[$(date)] Session ended. Sleeping 60s..." | tee -a "$LOGFILE"
    cd "$LOG_DIR" && ls -t local-2070-grind-*.log | tail -n +11 | xargs -r rm
    sleep 60
done
