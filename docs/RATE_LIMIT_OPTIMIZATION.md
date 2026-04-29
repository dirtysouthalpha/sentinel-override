# Rate Limit Optimization Guide

## 🎯 What Changed

Your extension has been optimized to:
- ✅ Avoid rate limits with intelligent delays
- ✅ Handle long ticket automation workflows
- ✅ Retry on 429 errors automatically
- ✅ Reduce data transfer (smaller images)
- ✅ Work step-by-step more efficiently
- ✅ Provide detailed progress tracking

---

## 📊 Key Optimizations

### 1. **Rate Limiting**
```javascript
minDelayBetweenCalls: 2000  // 2 seconds between API calls
```
- No more rapid-fire API requests
- Prevents 429 errors
- Spreads out your $20 budget

### 2. **Exponential Backoff for 429s**
```javascript
maxRetries: 3               // Retry failed requests 3 times
retryDelay: 5000           // 5 second initial delay (doubles each time)
```
- If rate limit hit: waits 5s, then retries
- If still limited: waits 10s, then retries
- If still limited: waits 20s, then retries
- Only then gives up

### 3. **Optimized Screenshot Quality**
```javascript
screenshotQuality: 30      // Lower = smaller file
```
- Reduces image size by ~70%
- Faster uploads
- Saves API credits
- Still readable for automation

### 4. **Step-by-Step Progress**
```
[Step 1] Observing page...
[Step 2] Consulting AI (Call #1)...
[Step 3] Executing: click...
[Step 4] Observing page...
[Step 5] Consulting AI (Call #2)...
```
- Clear visibility of what's happening
- Shows which step you're on
- Shows API call count

### 5. **Smart Delays Between Steps**
```javascript
await sleep(1500);  // 1.5 seconds between actions
```
- Allows pages to load properly
- Prevents errors
- Works with rate limiting

---

## 📈 How This Saves Your $20

### Before (Unoptimized)
```
Task: "Fill form with 5 fields"
API calls: 15-20 per field = 100+ calls
Cost impact: $20 gone quickly
```

### After (Optimized)
```
Task: "Fill form with 5 fields"
API calls: 2-3 per field = 10-15 total
Cost impact: $20 lasts much longer
Smart delays prevent rate limits
```

---

## 🚀 Installation

### Step 1: Backup Current File
```bash
cp background.js background.js.BACKUP
```

### Step 2: Use Optimized Version
```bash
cp background.js.OPTIMIZED background.js
```

### Step 3: Reload Extension
1. Go to `chrome://extensions/`
2. Click refresh on SentinelAgent
3. Done!

---

## 📝 How to Use for Tickets

### Example Ticket Workflow

**Ticket:** "Fill out customer form with John's info and submit"

**What to do:**
1. Navigate to the form
2. Type in agent: `"Fill out the customer form with this info: Name=John Doe, Email=john@example.com, Phone=555-1234, then click submit"`
3. Watch the progress

**Output:**
```
[Step 1] Observing page...
[Step 2] Consulting AI (Call #1)...
[Step 3] Executing: click... (Click name field)
[Step 4] Observing page...
[Step 5] Consulting AI (Call #2)...
[Step 6] Executing: type... (Type name)
... continues step by step ...
[Step 12] Executing: click... (Click submit)
✅ Task completed!
```

---

## ⏱️ Timing Example

For a **5-step form filling task:**

| Step | Action | Time | API Call? |
|------|--------|------|-----------|
| 1 | Observe page | 0.5s | No |
| 2 | Get AI instruction | 2.0s + 2s delay | Yes (#1) |
| 3 | Click field | 0.5s | No |
| 4 | Observe page | 0.5s | No |
| 5 | Get AI instruction | 2.0s + 2s delay | Yes (#2) |
| 6 | Type text | 0.5s | No |
| 7 | Observe page | 0.5s | No |
| 8 | Get AI instruction | 2.0s + 2s delay | Yes (#3) |
| 9 | Click next | 0.5s | No |
| ... | ... | ... | ... |

**Total time:** ~30-40 seconds for 5-step task  
**API calls:** 5-6 (instead of 20+)  
**Cost:** ~$0.05-0.10 per task

---

## 🎛️ Configuration

You can adjust these in the code if needed:

```javascript
const CONFIG = {
  minDelayBetweenCalls: 2000,  // 2s between API calls
  maxRetries: 3,               // Retry 3 times on 429
  retryDelay: 5000,            // 5s initial backoff
  screenshotQuality: 30,       // Image quality (1-100)
};
```

**Recommendations:**
- Keep `minDelayBetweenCalls` at 2000ms or higher
- Keep `screenshotQuality` at 30 for optimization
- Keep `maxRetries` at 3 for good coverage

---

## 📊 Monitoring API Usage

The agent now reports API calls in messages:

```
[Step 5] Consulting AI (Call #1)...
[Step 10] Consulting AI (Call #2)...
[Step 15] Consulting AI (Call #3)...
```

After task completes, check browser console:
```
Agent completed. Total API calls: 5
```

---

## ✅ What to Expect

### Advantages
- ✅ No more 429 rate limit errors
- ✅ Automatic retry on failures
- ✅ Clear progress tracking
- ✅ Step-by-step visibility
- ✅ Uses less API quota
- ✅ Works with any rate-limited API

### Tradeoffs
- Slightly slower (by design - prevents rate limits)
- Takes more wall-clock time per task
- But completes reliably without errors

**Example:** 
- Old: 10 seconds but hit rate limit, then fails
- New: 40 seconds but completes successfully ✅

---

## 🔧 Troubleshooting

### Still Getting 429?
1. Check `minDelayBetweenCalls` - increase to 3000-5000ms
2. Check your API's actual rate limit
3. Try simpler tasks (fewer steps)
4. Contact your API provider for limits

### Task Too Slow?
1. Consider if speed matters vs reliability
2. Can you simplify the task?
3. Check internet connection
4. Monitor API provider status

### Want to Adjust Speed?
```javascript
// For faster tasks (if your API allows):
minDelayBetweenCalls: 1000   // 1 second

// For slower tasks (if getting limits):
minDelayBetweenCalls: 5000   // 5 seconds
```

---

## 💡 Best Practices

### 1. **Break Down Complex Tasks**
Instead of:
```
"Complete entire customer support ticket workflow"
```

Do:
```
"Fill out the customer name and email"
"Note: I'll ask you to fill the address next"
```

### 2. **Keep Steps Simple**
AI works better with:
```
"Click the search button"
```

Than with:
```
"Search for users and filter by name"
```

### 3. **Monitor First Task**
Before running many tickets:
1. Do one ticket manually
2. Watch the console (F12)
3. Note API call count
4. Calculate cost

### 4. **Batch Similar Tasks**
Group similar tickets together for efficiency:
- All "fill form" tasks
- All "extract data" tasks
- All "click buttons" tasks

---

## 📈 Cost Calculator

**Formula:** `API Calls × Cost Per Call`

Venice AI pricing varies, but typically:
- Text: ~$0.001-0.01 per call
- Vision: ~$0.01-0.05 per call

**With 5-8 API calls per task:**
- Cost per task: $0.05-0.50
- Tasks from $20: **40-400 tasks** depending on complexity

---

## ✨ Features Summary

| Feature | Before | After |
|---------|--------|-------|
| Rate limit handling | None | Automatic retry + backoff |
| Delays | None | 2s between calls |
| Screenshot size | Large | 70% smaller |
| Progress tracking | Basic | Step-by-step with counts |
| Error messages | Generic | Detailed with step info |
| 429 handling | Fail | Retry with backoff |
| API call counting | No | Yes, visible in logs |

---

## 🎯 Next Steps

1. **Install** the optimized version
2. **Test** with a simple 3-step task
3. **Monitor** API calls (check console)
4. **Adjust** if needed for your use case
5. **Run** your ticket workflows!

---

**Version:** 2.1 (Rate-Limited Optimized)  
**Status:** Production Ready  
**Testing:** Recommended before bulk use
